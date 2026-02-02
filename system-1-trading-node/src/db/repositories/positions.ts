import crypto from "node:crypto";
import type { Db } from "../db";
import type { Position } from "../../../../shared/types";

export class PositionRepo {
  constructor(private readonly db: Db) {}

  list(): Position[] {
    const rows = this.db.prepare("SELECT * FROM positions ORDER BY opened_at DESC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      mint: r.mint,
      openedAt: r.opened_at,
      sizeSol: Number(r.size_sol),
      entrySignature: r.entry_signature ?? undefined,
      exitSignature: r.exit_signature ?? undefined,
      status: r.status,
      pnlSol: r.pnl_sol ?? undefined,
      notes: r.notes ?? undefined
    })) as Position[];
  }

  open(opts: {
    mint: string;
    sizeSol: number;
    entrySignature?: string;
    entryCostSol?: number;
    entryTokenAmountRaw?: string;
    tokenDecimals?: number;
    entryPriceSol?: number;
    strategyJson: string;
    stateJson: string;
  }): Position {
    const id = crypto.randomUUID();
    const openedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO positions(id, mint, opened_at, size_sol, status, entry_signature, entry_cost_sol, entry_token_amount_raw, token_decimals, entry_price_sol, strategy_json, state_json) VALUES(?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        opts.mint,
        openedAt,
        opts.sizeSol,
        opts.entrySignature ?? null,
        opts.entryCostSol ?? null,
        opts.entryTokenAmountRaw ?? null,
        opts.tokenDecimals ?? null,
        opts.entryPriceSol ?? null,
        opts.strategyJson,
        opts.stateJson
      );
    return { id, mint: opts.mint, openedAt, sizeSol: opts.sizeSol, entrySignature: opts.entrySignature, status: "OPEN" };
  }

  close(id: string, patch: Partial<Pick<Position, "exitSignature" | "pnlSol" | "status" | "notes">>): Position {
    const row = this.db.prepare("SELECT * FROM positions WHERE id = ?").get(id) as any;
    if (!row) throw new Error("Position not found");
    const status = patch.status ?? "CLOSED";
    const closedAt = status === "OPEN" ? null : new Date().toISOString();
    this.db
      .prepare(
        "UPDATE positions SET status=?, closed_at=?, exit_signature=?, pnl_sol=?, notes=? WHERE id=?"
      )
      .run(
        status,
        closedAt,
        patch.exitSignature ?? row.exit_signature ?? null,
        patch.pnlSol ?? row.pnl_sol ?? null,
        patch.notes ?? row.notes ?? null,
        id
      );
    const updated = this.db.prepare("SELECT * FROM positions WHERE id = ?").get(id) as any;
    return {
      id: updated.id,
      mint: updated.mint,
      openedAt: updated.opened_at,
      sizeSol: Number(updated.size_sol),
      entrySignature: updated.entry_signature ?? undefined,
      exitSignature: updated.exit_signature ?? undefined,
      status: updated.status,
      pnlSol: updated.pnl_sol ?? undefined,
      notes: updated.notes ?? undefined
    } as Position;
  }

  updateState(id: string, patch: { stateJson?: string; notes?: string }): void {
    const row = this.db.prepare("SELECT * FROM positions WHERE id=?").get(id) as any;
    if (!row) throw new Error("Position not found");
    this.db
      .prepare("UPDATE positions SET state_json=?, notes=? WHERE id=?")
      .run(patch.stateJson ?? row.state_json ?? "{}", patch.notes ?? row.notes ?? null, id);
  }

  updateEntryFields(id: string, patch: { entryCostSol?: number; entryTokenAmountRaw?: string; tokenDecimals?: number; entryPriceSol?: number }): void {
    const row = this.db.prepare("SELECT * FROM positions WHERE id=?").get(id) as any;
    if (!row) throw new Error("Position not found");
    this.db
      .prepare("UPDATE positions SET entry_cost_sol=?, entry_token_amount_raw=?, token_decimals=?, entry_price_sol=? WHERE id=?")
      .run(
        patch.entryCostSol ?? row.entry_cost_sol ?? null,
        patch.entryTokenAmountRaw ?? row.entry_token_amount_raw ?? null,
        patch.tokenDecimals ?? row.token_decimals ?? null,
        patch.entryPriceSol ?? row.entry_price_sol ?? null,
        id
      );
  }

  getOpenRows(): any[] {
    return this.db.prepare("SELECT * FROM positions WHERE status='OPEN' ORDER BY opened_at ASC").all() as any[];
  }
}
