import type { Db } from "../db";

export type MintGovernanceMode = "ALLOW" | "BLOCK";

export type MintGovernance = {
  mint: string;
  mode: MintGovernanceMode;
  reason: string | null;
  updatedAt: string;
};

export class GovernanceRepo {
  constructor(private readonly db: Db) {}

  get(mint: string): MintGovernance | null {
    const row = this.db.prepare("SELECT * FROM mint_governance WHERE mint=?").get(mint) as any;
    if (!row) return null;
    return { mint: row.mint, mode: row.mode, reason: row.reason ?? null, updatedAt: row.updated_at };
  }

  set(mint: string, mode: MintGovernanceMode, reason?: string | null): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO mint_governance(mint, mode, reason, updated_at) VALUES(?, ?, ?, ?) ON CONFLICT(mint) DO UPDATE SET mode=excluded.mode, reason=excluded.reason, updated_at=excluded.updated_at"
      )
      .run(mint, mode, reason ?? null, now);
  }

  remove(mint: string): void {
    this.db.prepare("DELETE FROM mint_governance WHERE mint=?").run(mint);
  }

  list(mode?: MintGovernanceMode): MintGovernance[] {
    const rows = mode
      ? (this.db.prepare("SELECT * FROM mint_governance WHERE mode=? ORDER BY updated_at DESC").all(mode) as any[])
      : (this.db.prepare("SELECT * FROM mint_governance ORDER BY updated_at DESC").all() as any[]);
    return rows.map((r) => ({ mint: r.mint, mode: r.mode, reason: r.reason ?? null, updatedAt: r.updated_at }));
  }
}

