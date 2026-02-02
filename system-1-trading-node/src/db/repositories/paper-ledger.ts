import crypto from "node:crypto";
import type { Db } from "../db";

export class PaperLedgerRepo {
  constructor(private readonly db: Db) {}

  record(opts: { kind: string; mint?: string | null; solDelta: number; note?: string | null }): void {
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();
    this.db
      .prepare("INSERT INTO paper_ledger(id, ts, kind, mint, sol_delta, note) VALUES(?, ?, ?, ?, ?, ?)")
      .run(id, ts, opts.kind, opts.mint ?? null, opts.solDelta, opts.note ?? null);
  }

  getSolBalance(initialSol: number): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(sol_delta), 0) AS s FROM paper_ledger").get() as any;
    const delta = Number(row?.s ?? 0);
    return initialSol + delta;
  }
}

export class PaperBalancesRepo {
  constructor(private readonly db: Db) {}

  get(mint: string): { amountRaw: bigint; decimals: number } {
    const row = this.db.prepare("SELECT * FROM paper_balances WHERE mint=?").get(mint) as any;
    if (!row) return { amountRaw: 0n, decimals: 0 };
    return { amountRaw: BigInt(String(row.amount_raw)), decimals: Number(row.decimals) };
  }

  upsert(mint: string, amountRaw: bigint, decimals: number): void {
    this.db
      .prepare("INSERT INTO paper_balances(mint, amount_raw, decimals) VALUES(?, ?, ?) ON CONFLICT(mint) DO UPDATE SET amount_raw=excluded.amount_raw, decimals=excluded.decimals")
      .run(mint, amountRaw.toString(), decimals);
  }
}
