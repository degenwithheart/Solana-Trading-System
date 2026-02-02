import { PublicKey } from "@solana/web3.js";
import type { TradingConfig } from "../../shared/types";
import type { TradingEnv } from "./env";
import { DiscoveryService } from "./chain/discovery";
import { ChainIntelligence } from "./chain/intelligence";
import { FeatureEngine } from "./features/feature-engine";
import { FilterSystem } from "./filters/filter-system";
import { ModelClient } from "./ml/model-client";
import { StrategyEngine } from "./strategy/strategy-engine";
import type { DegenAiController } from "./ai/degen-policy";
import { RiskManager } from "./risk/risk-manager";
import { Logger } from "./utils/logger";
import { RpcManager } from "./rpc/rpc-manager";
import { SignerClient } from "./execution/signer-client";
import { JupiterExecutor } from "./execution/jupiter-executor";
import type { PositionRepo } from "./db/repositories/positions";
import type { ControlsRepo } from "./controls/controls";
import { getSolDeltaFromTx, getTokenDeltaRawFromTx } from "./chain/tx-deltas";
import { ExitEngine } from "./exit/exit-engine";
import type { TxAttemptsRepo } from "./db/repositories/tx-attempts";
import { Reconciler } from "./reconciliation/reconciler";
import type { GovernanceRepo } from "./db/repositories/governance";
import type { ActionDedupeRepo } from "./db/repositories/action-dedupe";
import type { PaperLedgerRepo } from "./db/repositories/paper-ledger";
import type { PaperBalancesRepo } from "./db/repositories/paper-ledger";

export type OrchestratorStatus = {
  running: boolean;
  lastTickAt?: string;
  lastError?: string;
  candidates: number;
  openPositions: number;
  ai?: { enabled: boolean; trainedSamples: number; canControl: boolean; reason?: string; rolling24hAiPnlSol: number };
};

export class Orchestrator {
  private running = false;
  private status: OrchestratorStatus = { running: false, candidates: 0, openPositions: 0 };
  private loopPromise: Promise<void> | null = null;

  private readonly filter: FilterSystem;
  private readonly features = new FeatureEngine();
  private readonly model = new ModelClient();
  private readonly strategy: StrategyEngine;
  private readonly signer: SignerClient;
  private readonly executor: JupiterExecutor;
  private readonly exitEngine: ExitEngine;
  private readonly reconciler: Reconciler;

  constructor(
    private readonly deps: {
      env: TradingEnv;
      cfg: TradingConfig;
      log: Logger;
      rpc: RpcManager;
      discovery: DiscoveryService;
      intelligence: ChainIntelligence;
      risk: RiskManager;
      positions: PositionRepo;
      controls: ControlsRepo;
      txAttempts: TxAttemptsRepo;
      governance: GovernanceRepo;
      actionDedupe: ActionDedupeRepo;
      paperLedger: PaperLedgerRepo;
      paperBalances: PaperBalancesRepo;
      ai: DegenAiController;
    }
  ) {
    this.filter = new FilterSystem(deps.cfg.filters);
    this.strategy = new StrategyEngine({ strategyCfg: deps.cfg.strategy, aiCfg: deps.cfg.ai, ai: deps.ai, log: deps.log });
    this.signer = new SignerClient({
      baseUrl: deps.env.SIGNER_URL,
      timeoutMs: deps.env.SIGNER_TIMEOUT_MS,
      retries: deps.env.SIGNER_RETRY_ATTEMPTS,
      apiKey: deps.env.API_KEY || undefined
    });
    this.executor = new JupiterExecutor({
      baseUrl: deps.env.JUPITER_BASE_URL,
      wsolMint: new PublicKey(deps.cfg.constants.wsolMint),
      signer: this.signer
    });
    this.exitEngine = new ExitEngine({
      cfg: deps.cfg,
      rpc: deps.rpc,
      positions: deps.positions,
      risk: deps.risk,
      executor: this.executor,
      log: deps.log,
      jupiterPriceUrl: deps.env.JUPITER_PRICE_URL,
      txAttempts: deps.txAttempts,
      paperLedger: deps.paperLedger,
      paperBalances: deps.paperBalances,
      ai: deps.ai
    });
    this.reconciler = new Reconciler({ rpc: deps.rpc, positions: deps.positions, log: deps.log });
  }

  getStatus(): OrchestratorStatus {
    const positions = this.deps.risk.listPositions();
    const open = positions.filter((p) => p.status === "OPEN").length;
    const candidates = this.deps.discovery.list(250).length;
    const now = Date.now();
    const aiCtl = this.deps.ai.canControlNow(now);
    this.status = {
      ...this.status,
      candidates,
      openPositions: open,
      running: this.running,
      ai: {
        enabled: this.deps.cfg.ai.enabled,
        trainedSamples: this.deps.ai.trainedSamples(),
        canControl: aiCtl.ok,
        reason: aiCtl.reason,
        rolling24hAiPnlSol: this.deps.ai.rolling24hAiPnlSol(now)
      }
    };
    return this.status;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.status = { running: true, candidates: 0, openPositions: 0 };
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = null;
  }

  async tickOnce(): Promise<void> {
    await this.tick();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      await this.tick().catch((e) => {
        this.status.lastError = e instanceof Error ? e.message : "unknown_error";
        this.deps.log.error("tick_failed", { error: this.status.lastError });
        this.deps.risk.tripCircuitBreaker();
      });
      await sleep(this.deps.env.HEARTBEAT_INTERVAL_MS);
    }
  }

  private async tick(): Promise<void> {
    this.status.lastTickAt = new Date().toISOString();
    const candidates = this.deps.discovery.list(250);
    this.status.candidates = candidates.length;

    const positions = this.deps.risk.listPositions();
    const openPositions = positions.filter((p) => p.status === "OPEN");
    this.status.openPositions = openPositions.length;

    const controls = this.deps.controls.load(this.deps.cfg.controls);
    const activeProfileName = this.deps.controls.getActiveProfile(this.deps.cfg.activeProfile);
    const profile = this.deps.cfg.profiles[activeProfileName];
    if (!profile || !profile.enabled) throw new Error("Active profile is missing or disabled");

    const signerOk = await this.signer.health().catch(() => false);
    if (!signerOk) throw new Error("signer_unhealthy");
    const user = await this.signer.getPublicKey();

    if (this.deps.cfg.mode === "live") {
      await this.reconciler.runOnce(user).catch((e) => this.deps.log.warn("reconcile_failed", { error: String(e) }));
    }

    // Exits first (kill switch forces exits even if pauseExits).
    if (!controls.pauseExits || controls.killSwitch) {
      await this.exitEngine.runOnce({
        owner: user,
        venues: orderedVenues(this.deps.cfg),
        profileName: activeProfileName
      });
    }

    if (controls.killSwitch || controls.pauseEntries) return;
    if (candidates.length === 0) return;

    const canOpen = this.deps.risk.canOpenPosition(openPositions.length);
    if (!canOpen.ok) return;

    const candidate = candidates[0]; // deterministic ordering
    if (openPositions.some((p) => p.mint === candidate.mint)) {
      this.deps.discovery.remove(candidate.mint);
      return;
    }
    if (!this.isMintAllowed(candidate.mint)) {
      this.deps.log.info("candidate_blocked_by_governance", { mint: candidate.mint });
      this.deps.discovery.remove(candidate.mint);
      return;
    }

    // Per-mint cooldown and attempt cap (config-driven).
    const keyAttempt = `attempt:${candidate.mint}:${new Date().toISOString().slice(0, 10)}:${Date.now()}`;
    // This just uses the dedupe table as a cheap monotonic counter: claim N distinct keys/day in memory window isn't possible,
    // so we enforce attempt cap by using a fixed TTL bucket and rejecting repeated claims within that bucket.
    const bucketMs = Math.floor((24 * 60 * 60 * 1000) / Math.max(1, this.deps.cfg.governance.maxAttemptsPerMintPerDay));
    const bucket = Math.floor(Date.now() / bucketMs);
    const capKey = `cap:${candidate.mint}:${new Date().toISOString().slice(0, 10)}:${bucket}`;
    if (!this.deps.actionDedupe.claim(capKey, bucketMs)) {
      this.deps.log.info("candidate_blocked_by_attempt_cap", { mint: candidate.mint });
      return;
    }
    const keyCooldown = `cooldown:${candidate.mint}`;
    if (!this.deps.actionDedupe.claim(keyCooldown, this.deps.cfg.governance.cooldownMinutesPerMint * 60_000)) {
      return;
    }
    const feats = await this.deps.intelligence.getFeatures(candidate.mint);
    const filterRes = this.filter.evaluate(feats);
    if (!filterRes.pass) {
      this.deps.log.info("candidate_filtered", { mint: candidate.mint, reasons: filterRes.reasons });
      this.deps.discovery.remove(candidate.mint);
      return;
    }

    const vec = this.features.build(feats);
    const score = this.model.score(candidate.mint, vec);
    this.deps.discovery.markScored({
      mint: candidate.mint,
      confidence: score.confidence,
      pump: score.pumpProbability,
      rug: score.rugProbability,
      reasons: score.reasons
    });
    const allowedProfiles = Object.entries(this.deps.cfg.profiles)
      .filter(([, p]) => !!p?.enabled)
      .map(([name]) => name);
    const decision = this.strategy.decideEntry({
      score,
      tokenFeatures: feats,
      featureVector: vec,
      defaultProfile: activeProfileName,
      allowedProfiles
    });
    if (decision.action !== "ENTER") {
      this.deps.log.info("candidate_skipped", { mint: candidate.mint, reason: decision.reason, controller: decision.controller, score, ai: decision.ai ?? null });
      this.deps.discovery.remove(candidate.mint);
      return;
    }

    const entryProfileName = decision.profile;
    const entryProfile = this.deps.cfg.profiles[entryProfileName];
    if (!entryProfile || !entryProfile.enabled) throw new Error("Entry profile is missing or disabled");
    if (openPositions.length >= entryProfile.entry.maxOpenPositions) {
      this.deps.log.info("candidate_skipped", {
        mint: candidate.mint,
        reason: "profile_max_open_positions",
        controller: decision.controller,
        profile: entryProfileName
      });
      this.deps.discovery.remove(candidate.mint);
      return;
    }

    const balanceLamports = await this.deps.rpc.withConnection((c) => c.getBalance(user, "confirmed"));
    const balanceSol = balanceLamports / 1e9;

    const sizeSol = clampSol(
      entryProfile.entry.positionSizeFixedSol + (balanceSol * entryProfile.entry.positionSizeWalletPct) / 100,
      entryProfile.entry.positionSizeMinSol,
      entryProfile.entry.positionSizeMaxSol
    );
    if (sizeSol <= 0) return;

    const sizeLamports = BigInt(Math.floor(sizeSol * 1e9));
    const { signature, venueName, simulated, paperOutRaw, paperDecimals } = await executeEntryWithVenues({
      rpc: this.deps.rpc,
      executor: this.executor,
      cfg: this.deps.cfg,
      txAttempts: this.deps.txAttempts,
      mint: candidate.mint,
      user,
      sizeLamports,
      sizeSol,
      paperLedger: this.deps.paperLedger,
      paperBalances: this.deps.paperBalances
    });

    let entryCostSol: number | undefined;
    let tokenDeltaRaw: bigint | undefined;
    let decimals: number | undefined;
    let entryPriceSol: number | undefined;

    if (!simulated) {
      const tx = await this.deps.rpc.withConnection((c) =>
        c.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      );
      if (!tx) throw new Error("Entry transaction not found");
      const solDelta = getSolDeltaFromTx(tx, user); // negative for buys
      entryCostSol = solDelta < 0 ? -solDelta : 0;
      const td = getTokenDeltaRawFromTx(tx, user, new PublicKey(candidate.mint));
      tokenDeltaRaw = td.delta;
      decimals = td.decimals;
      const tokensReceived = tokenDeltaRaw > 0n ? Number(tokenDeltaRaw) / 10 ** decimals : 0;
      entryPriceSol = tokensReceived > 0 ? entryCostSol / tokensReceived : undefined;
    } else {
      entryCostSol = sizeSol;
      if (this.deps.cfg.mode === "paper") {
        tokenDeltaRaw = paperOutRaw ? BigInt(paperOutRaw) : undefined;
        decimals = paperDecimals;
        const tokensReceived =
          tokenDeltaRaw && typeof decimals === "number" ? Number(tokenDeltaRaw) / 10 ** decimals : 0;
        entryPriceSol = tokensReceived > 0 ? entryCostSol / tokensReceived : undefined;
      } else {
        tokenDeltaRaw = undefined;
        decimals = undefined;
        entryPriceSol = undefined;
      }
    }
    const opened = this.deps.risk.openPosition({
      mint: candidate.mint,
      sizeSol,
      entrySignature: signature,
      entryCostSol,
      entryTokenAmountRaw: tokenDeltaRaw && tokenDeltaRaw > 0n ? tokenDeltaRaw.toString() : undefined,
      tokenDecimals: decimals,
      entryPriceSol,
      strategyJson: JSON.stringify({ profile: entryProfileName, venue: venueName, controller: decision.controller }),
      stateJson: JSON.stringify({ takeProfitHits: [] as number[], highWaterPriceSol: null as number | null, maxDrawdownPct: 0 })
    });
    const action = (decision.controller === "ai" && decision.ai?.action?.startsWith("profile:") ? decision.ai.action : `profile:${entryProfileName}`) as const;
    this.deps.ai.onEntry(
      opened.id,
      decision.snapshot,
      action,
      decision.controller,
      Date.parse(opened.openedAt) || Date.now()
    );
    this.deps.discovery.remove(candidate.mint);
    this.deps.log.info("position_opened", { mint: candidate.mint, sizeSol, signature, score });
  }

  private isMintAllowed(mint: string): boolean {
    const rule = this.deps.governance.get(mint);
    if (rule?.mode === "BLOCK") return false;
    if (this.deps.cfg.governance.mintBlocklist.includes(mint)) return false;
    const allow = this.deps.cfg.governance.mintAllowlist;
    if (allow.length > 0 && !allow.includes(mint)) return false;
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clampSol(value: number, min: number, max: number): number {
  const v = Number.isFinite(value) ? value : 0;
  const lo = Math.max(0, min);
  const hi = Math.max(lo, max);
  return Math.min(hi, Math.max(lo, v));
}

async function executeEntryWithVenues(opts: {
  rpc: RpcManager;
  executor: JupiterExecutor;
  cfg: TradingConfig;
  txAttempts: TxAttemptsRepo;
  paperLedger: PaperLedgerRepo;
  paperBalances: PaperBalancesRepo;
  mint: string;
  user: PublicKey;
  sizeLamports: bigint;
  sizeSol: number;
}): Promise<{ signature: string; venueName: string; simulated: boolean; paperOutRaw?: string; paperDecimals?: number }> {
  if (opts.cfg.mode === "shadow") {
    // Shadow mode: exercise quote/route logic but do not sign/send.
    const venue = orderedVenues(opts.cfg)[0];
    const attemptId = opts.txAttempts.start({ kind: "ENTRY", mint: opts.mint, venue: venue.name, amountSol: opts.sizeSol });
    opts.txAttempts.failed(attemptId, "shadow_mode_no_send");
    return { signature: `shadow:${Date.now()}`, venueName: venue.name, simulated: true };
  }

  if (opts.cfg.mode === "paper") {
    const venue = orderedVenues(opts.cfg)[0];
    const attemptId = opts.txAttempts.start({ kind: "ENTRY", mint: opts.mint, venue: venue.name, amountSol: opts.sizeSol });
    // Paper: record spend immediately; no on-chain tx.
    const balance = opts.paperLedger.getSolBalance(opts.cfg.paper.initialSol);
    if (balance - opts.cfg.paper.feeReserveSol < opts.sizeSol) {
      opts.txAttempts.failed(attemptId, "paper_insufficient_balance");
      throw new Error("Paper balance insufficient");
    }
    const quote = await opts.executor.getQuote({
      inputMint: new PublicKey(opts.cfg.constants.wsolMint),
      outputMint: new PublicKey(opts.mint),
      amount: BigInt(Math.floor(opts.sizeSol * 1e9)),
      slippageBps: venue.slippageBps,
      onlyDirectRoutes: venue.onlyDirectRoutes,
      allowedDexLabels: venue.allowedDexLabels,
      maxRouteSteps: opts.cfg.mev.maxRouteSteps,
      maxPriceImpactPct: opts.cfg.mev.maxPriceImpactPct,
      maxQuoteDriftBps: opts.cfg.mev.maxQuoteDriftBps
    });
    const outRaw = BigInt(String(quote?.outAmount ?? "0"));
    const decimals = await opts.rpc.withConnection((c) => c.getParsedAccountInfo(new PublicKey(opts.mint), "confirmed")).then((info) => {
      const d = (info.value?.data as any)?.parsed?.info?.decimals;
      if (typeof d !== "number") throw new Error("Unable to read mint decimals");
      return d;
    });
    const prev = opts.paperBalances.get(opts.mint);
    opts.paperBalances.upsert(opts.mint, prev.amountRaw + outRaw, decimals);
    opts.paperLedger.record({ kind: "ENTRY_BUY", mint: opts.mint, solDelta: -opts.sizeSol, note: `venue=${venue.name}` });
    opts.txAttempts.submitted(attemptId, `paper:${Date.now()}`);
    opts.txAttempts.confirmed(attemptId);
    return { signature: `paper:${Date.now()}`, venueName: venue.name, simulated: true, paperOutRaw: outRaw.toString(), paperDecimals: decimals };
  }

  const venues = orderedVenues(opts.cfg);
  let lastErr: unknown = null;
  for (const v of venues) {
    const attemptId = opts.txAttempts.start({ kind: "ENTRY", mint: opts.mint, venue: v.name, amountSol: opts.sizeSol });
    try {
      const sig = await opts.rpc.withConnection(async (conn) => {
        const res = await opts.executor.swapSolToToken({
          conn,
          outputMint: new PublicKey(opts.mint),
          solLamports: opts.sizeLamports,
          userPublicKey: opts.user,
          venue: v,
          mev: { maxRouteSteps: opts.cfg.mev.maxRouteSteps, maxPriceImpactPct: opts.cfg.mev.maxPriceImpactPct, maxQuoteDriftBps: opts.cfg.mev.maxQuoteDriftBps }
        });
        return res.signature;
      });
      opts.txAttempts.submitted(attemptId, sig);
      opts.txAttempts.confirmed(attemptId);
      return { signature: sig, venueName: v.name, simulated: false };
    } catch (e) {
      lastErr = e;
      opts.txAttempts.failed(attemptId, e instanceof Error ? e.message : String(e));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All venues failed");
}

function orderedVenues(cfg: TradingConfig): TradingConfig["execution"]["venues"] {
  const byName = new Map(cfg.execution.venues.map((v) => [v.name, v]));
  const out: TradingConfig["execution"]["venues"] = [];
  for (const name of cfg.execution.venueOrder) {
    const v = byName.get(name);
    if (v && v.enabled) out.push(v);
  }
  for (const v of cfg.execution.venues) {
    if (v.enabled && !out.includes(v)) out.push(v);
  }
  return out;
}
