import { PublicKey } from "@solana/web3.js";
import type { TradingConfig } from "../../../shared/types";
import type { RpcManager } from "../rpc/rpc-manager";
import type { PositionRepo } from "../db/repositories/positions";
import type { RiskManager } from "../risk/risk-manager";
import type { Logger } from "../utils/logger";
import { JupiterPriceService } from "../market/jupiter-price";
import { getTokenBalanceRaw } from "../chain/token-utils";
import type { JupiterExecutor } from "../execution/jupiter-executor";
import { getSolDeltaFromTx, getTokenDeltaRawFromTx } from "../chain/tx-deltas";
import type { TxAttemptsRepo } from "../db/repositories/tx-attempts";
import type { PaperLedgerRepo } from "../db/repositories/paper-ledger";
import type { PaperBalancesRepo } from "../db/repositories/paper-ledger";

type PositionRow = any;

export class ExitEngine {
  private readonly wsolMint: PublicKey;
  private readonly price: JupiterPriceService;

  constructor(
    private readonly deps: {
      cfg: TradingConfig;
      rpc: RpcManager;
      positions: PositionRepo;
      risk: RiskManager;
      executor: JupiterExecutor;
      log: Logger;
      jupiterPriceUrl: string;
      txAttempts: TxAttemptsRepo;
      paperLedger: PaperLedgerRepo;
      paperBalances: PaperBalancesRepo;
    }
  ) {
    this.wsolMint = new PublicKey(deps.cfg.constants.wsolMint);
    this.price = new JupiterPriceService(deps.jupiterPriceUrl, 8000);
  }

  async runOnce(opts: { owner: PublicKey; venues: TradingConfig["execution"]["venues"]; profileName: string }): Promise<void> {
    const profile = this.deps.cfg.profiles[opts.profileName];
    if (!profile || !profile.enabled) throw new Error("Active profile missing/disabled");

    const rows: PositionRow[] = this.deps.positions.getOpenRows();
    if (rows.length === 0) return;

    const mintPks = rows.map((r) => new PublicKey(r.mint));
    const prices = await this.price.getUsdPrices([this.wsolMint, ...mintPks]);
    const solUsd = prices.get(this.wsolMint.toBase58());
    if (!solUsd) throw new Error("Missing SOL price");

    for (const row of rows) {
      const mint = new PublicKey(row.mint);
      const tokenUsd = prices.get(mint.toBase58());
      if (!tokenUsd) continue;
      const currentPriceSol = tokenUsd / solUsd;

      const openedAt = Date.parse(String(row.opened_at));
      const ageMin = openedAt ? (Date.now() - openedAt) / (1000 * 60) : 0;

      const entryPriceSol = typeof row.entry_price_sol === "number" && Number.isFinite(row.entry_price_sol) ? row.entry_price_sol : null;
      if (!entryPriceSol || entryPriceSol <= 0) continue;

      const profitPct = ((currentPriceSol - entryPriceSol) / entryPriceSol) * 100;
      const state = safeJsonParse(row.state_json, { takeProfitHits: [], highWaterPriceSol: null, realizedPnlSol: 0 });

      if (state.highWaterPriceSol === null || currentPriceSol > state.highWaterPriceSol) {
        state.highWaterPriceSol = currentPriceSol;
      }

      const balanceRaw =
        this.deps.cfg.mode === "paper"
          ? this.deps.paperBalances.get(mint.toBase58()).amountRaw
          : await this.deps.rpc.withConnection((c) => getTokenBalanceRaw(c, opts.owner, mint));
      if (balanceRaw === 0n) {
        this.deps.positions.updateState(row.id, {
          stateJson: JSON.stringify({ ...state, lastSeenBalanceRaw: "0" }),
          notes: "token_balance_zero_reconciled"
        });
        continue;
      }

      // Time stop
      if (ageMin >= profile.exits.maxHoldMinutes) {
        await this.sellAll(row, opts.owner, mint, balanceRaw, currentPriceSol, entryPriceSol, opts.venues);
        continue;
      }

      // Hard stop-loss
      if (profitPct <= -Math.abs(profile.exits.stopLossPct)) {
        await this.sellAll(row, opts.owner, mint, balanceRaw, currentPriceSol, entryPriceSol, opts.venues);
        continue;
      }

      // Take-profit ladder (partial sells)
      for (let i = 0; i < profile.exits.takeProfitLevels.length; i++) {
        const level = profile.exits.takeProfitLevels[i];
        if (state.takeProfitHits.includes(i)) continue;
        if (profitPct < level.profitPct) continue;
        const sellPct = clampPct(level.sellPct);
        const sellRaw = (balanceRaw * BigInt(Math.floor(sellPct * 100))) / 10000n;
        if (sellRaw <= 0n) continue;
        await this.sellPartial(row, opts.owner, mint, sellRaw, { kind: "TP", index: i }, currentPriceSol, entryPriceSol, opts.venues, state);
        // Refresh remaining balance next tick.
        break;
      }

      // Trailing stop (after activation threshold)
      if (profile.exits.trailingStop.enabled && profitPct >= profile.exits.trailingStop.activationProfitPct) {
        const high = Number(state.highWaterPriceSol ?? currentPriceSol);
        const drawdownPct = high > 0 ? ((high - currentPriceSol) / high) * 100 : 0;
        if (drawdownPct >= profile.exits.trailingStop.trailingPct) {
          await this.sellAll(row, opts.owner, mint, balanceRaw, currentPriceSol, entryPriceSol, opts.venues);
          continue;
        }
      }

      this.deps.positions.updateState(row.id, {
        stateJson: JSON.stringify({ ...state, lastSeenBalanceRaw: balanceRaw.toString(), lastPriceSol: currentPriceSol, lastProfitPct: profitPct })
      });
    }
  }

  private async sellAll(
    row: PositionRow,
    owner: PublicKey,
    mint: PublicKey,
    balanceRaw: bigint,
    currentPriceSol: number,
    entryPriceSol: number,
    venues: TradingConfig["execution"]["venues"]
  ): Promise<void> {
    await this.sellPartial(row, owner, mint, balanceRaw, { kind: "FINAL" }, currentPriceSol, entryPriceSol, venues, safeJsonParse(row.state_json, {}));
  }

  private async sellPartial(
    row: PositionRow,
    owner: PublicKey,
    mint: PublicKey,
    sellRaw: bigint,
    reason: { kind: "TP"; index: number } | { kind: "FINAL" },
    currentPriceSol: number,
    entryPriceSol: number,
    venues: TradingConfig["execution"]["venues"],
    state: any
  ): Promise<void> {
    let lastErr: unknown = null;
    let sig: string | null = null;
    let venueName: string | null = null;
    for (const venue of venues) {
      const attemptId = this.deps.txAttempts.start({
        kind: "EXIT",
        mint: mint.toBase58(),
        positionId: row.id,
        venue: venue.name,
        amountSol: null
      });
      try {
        let s: string;
        if (this.deps.cfg.mode === "shadow") {
          s = `shadow-exit:${Date.now()}`;
          this.deps.txAttempts.failed(attemptId, "shadow_mode_no_send");
          throw new Error("shadow_mode_no_send");
        } else if (this.deps.cfg.mode === "paper") {
          // Quote token->SOL, then apply ledger changes.
          const quote = await this.deps.executor.getQuote({
            inputMint: mint,
            outputMint: this.wsolMint,
            amount: sellRaw,
            slippageBps: venue.slippageBps,
            onlyDirectRoutes: venue.onlyDirectRoutes,
            allowedDexLabels: venue.allowedDexLabels,
            maxRouteSteps: this.deps.cfg.mev.maxRouteSteps,
            maxPriceImpactPct: this.deps.cfg.mev.maxPriceImpactPct,
            maxQuoteDriftBps: this.deps.cfg.mev.maxQuoteDriftBps
          });
          const outLamports = BigInt(String(quote?.outAmount ?? "0"));
          const receivedSol = Number(outLamports) / 1e9;
          const bal = this.deps.paperBalances.get(mint.toBase58());
          this.deps.paperBalances.upsert(mint.toBase58(), bal.amountRaw - sellRaw, bal.decimals);
          this.deps.paperLedger.record({ kind: "EXIT_SELL", mint: mint.toBase58(), solDelta: receivedSol, note: `venue=${venue.name}` });
          state.lastExitReceivedSol = receivedSol;
          s = `paper-exit:${Date.now()}`;
        } else {
          s = await this.deps.rpc.withConnection(async (conn) => {
            const res = await this.deps.executor.swapTokenToSol({
              conn,
              inputMint: mint,
              tokenAmount: sellRaw,
              userPublicKey: owner,
              venue,
              mev: {
                maxRouteSteps: this.deps.cfg.mev.maxRouteSteps,
                maxPriceImpactPct: this.deps.cfg.mev.maxPriceImpactPct,
                maxQuoteDriftBps: this.deps.cfg.mev.maxQuoteDriftBps
              }
            });
            return res.signature;
          });
        }
        this.deps.txAttempts.submitted(attemptId, s);
        this.deps.txAttempts.confirmed(attemptId);
        sig = s;
        venueName = venue.name;
        break;
      } catch (e) {
        lastErr = e;
        this.deps.txAttempts.failed(attemptId, e instanceof Error ? e.message : String(e));
      }
    }
    if (!sig || !venueName) throw (lastErr instanceof Error ? lastErr : new Error("All venues failed for exit"));

    let receivedSol: number;
    let soldRaw: bigint;
    let decimals: number;
    if (this.deps.cfg.mode === "paper") {
      // Approximate: we already applied paper ledger; use the requested amount and assume filled.
      const bal = this.deps.paperBalances.get(mint.toBase58());
      decimals = bal.decimals;
      soldRaw = sellRaw;
      // Find last ledger entry? We already computed receivedSol above; store in state for PnL.
      receivedSol = Number(state.lastExitReceivedSol ?? 0) || 0;
    } else {
      const tx = await this.deps.rpc.withConnection((c) =>
        c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      );
      if (!tx) throw new Error("Exit transaction not found");
      const solDelta = getSolDeltaFromTx(tx, owner); // positive for sells (net of fees)
      receivedSol = solDelta > 0 ? solDelta : 0;
      const td = getTokenDeltaRawFromTx(tx, owner, mint); // negative for sells
      decimals = td.decimals;
      soldRaw = td.delta < 0n ? -td.delta : 0n;
    }

    const entryCostSol = typeof row.entry_cost_sol === "number" && Number.isFinite(row.entry_cost_sol) ? row.entry_cost_sol : null;
    const entryTokenRaw = row.entry_token_amount_raw ? BigInt(String(row.entry_token_amount_raw)) : null;
    const costBasis =
      entryCostSol !== null && entryTokenRaw !== null && entryTokenRaw > 0n
        ? entryCostSol * ratio(soldRaw, entryTokenRaw)
        : entryPriceSol * (soldRaw > 0n ? Number(soldRaw) / 10 ** decimals : 0);
    const realized = receivedSol - costBasis;
    this.deps.risk.recordRealizedPnl(realized);

    if (reason.kind === "TP") {
      state.takeProfitHits = Array.isArray(state.takeProfitHits) ? state.takeProfitHits : [];
      if (!state.takeProfitHits.includes(reason.index)) state.takeProfitHits.push(reason.index);
    }

    state.lastExitSignature = sig;
    state.lastExitReceivedSol = receivedSol;
    state.realizedPnlSol = (Number(state.realizedPnlSol ?? 0) || 0) + realized;

    if (reason.kind === "FINAL") {
      this.deps.risk.closePosition(row.id, { exitSignature: sig, pnlSol: Number(state.realizedPnlSol ?? 0), status: "CLOSED", notes: "exit_all" });
    } else {
      this.deps.positions.updateState(row.id, { stateJson: JSON.stringify(state) });
    }

    this.deps.log.info("exit_executed", { mint: mint.toBase58(), signature: sig, sellRaw: sellRaw.toString(), venue: venueName });
  }
}

function safeJsonParse(text: string | null | undefined, fallback: any): any {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(100, p));
}

function ratio(n: bigint, d: bigint): number {
  if (d <= 0n) return 0;
  const SCALE = 1_000_000n;
  const v = (n * SCALE) / d;
  return Number(v) / Number(SCALE);
}
