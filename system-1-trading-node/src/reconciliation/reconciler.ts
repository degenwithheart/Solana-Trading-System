import { PublicKey } from "@solana/web3.js";
import type { RpcManager } from "../rpc/rpc-manager";
import type { PositionRepo } from "../db/repositories/positions";
import type { Logger } from "../utils/logger";
import { getTokenBalanceRaw } from "../chain/token-utils";
import { getSolDeltaFromTx, getTokenDeltaRawFromTx } from "../chain/tx-deltas";

export class Reconciler {
  constructor(private readonly deps: { rpc: RpcManager; positions: PositionRepo; log: Logger }) {}

  async runOnce(owner: PublicKey): Promise<void> {
    const rows = this.deps.positions.getOpenRows();
    if (rows.length === 0) return;

    for (const row of rows) {
      const mint = new PublicKey(row.mint);
      const balanceRaw = await this.deps.rpc.withConnection((c) => getTokenBalanceRaw(c, owner, mint));

      const state = safeJsonParse(row.state_json, {});
      state.lastSeenBalanceRaw = balanceRaw.toString();
      this.deps.positions.updateState(row.id, { stateJson: JSON.stringify(state) });

      // Backfill entry fields if missing.
      if ((!row.entry_token_amount_raw || row.entry_price_sol == null) && row.entry_signature) {
        const tx = await this.deps.rpc.withConnection((c) =>
          c.getTransaction(String(row.entry_signature), { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
        );
        if (tx) {
          const solDelta = getSolDeltaFromTx(tx, owner);
          const entryCostSol = solDelta < 0 ? -solDelta : null;
          const { delta: tokenDeltaRaw, decimals } = getTokenDeltaRawFromTx(tx, owner, mint);
          const tokens = tokenDeltaRaw > 0n ? Number(tokenDeltaRaw) / 10 ** decimals : 0;
          const entryPriceSol = entryCostSol !== null && tokens > 0 ? entryCostSol / tokens : null;
          this.deps.positions.updateEntryFields(row.id, {
            entryCostSol: entryCostSol ?? undefined,
            entryTokenAmountRaw: tokenDeltaRaw > 0n ? tokenDeltaRaw.toString() : undefined,
            tokenDecimals: decimals,
            entryPriceSol: entryPriceSol ?? undefined
          });
          this.deps.log.info("reconcile_entry_backfill", { positionId: row.id, mint: row.mint });
        }
      }
    }
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

