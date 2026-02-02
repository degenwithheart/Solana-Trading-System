import crypto from "node:crypto";
import type { Db } from "../db";

export type TxAttempt = {
  id: string;
  createdAt: string;
  kind: "ENTRY" | "EXIT";
  mint: string | null;
  positionId: string | null;
  venue: string;
  amountSol: number | null;
  signature: string | null;
  status: "STARTED" | "SUBMITTED" | "CONFIRMED" | "FAILED";
  error: string | null;
};

export class TxAttemptsRepo {
  constructor(private readonly db: Db) {}

  start(opts: { kind: TxAttempt["kind"]; mint?: string | null; positionId?: string | null; venue: string; amountSol?: number | null }): string {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO tx_attempts(id, created_at, kind, mint, position_id, venue, amount_sol, signature, status, error) VALUES(?, ?, ?, ?, ?, ?, ?, NULL, 'STARTED', NULL)"
      )
      .run(id, createdAt, opts.kind, opts.mint ?? null, opts.positionId ?? null, opts.venue, opts.amountSol ?? null);
    return id;
  }

  submitted(id: string, signature: string): void {
    this.db.prepare("UPDATE tx_attempts SET signature=?, status='SUBMITTED' WHERE id=?").run(signature, id);
  }

  confirmed(id: string): void {
    this.db.prepare("UPDATE tx_attempts SET status='CONFIRMED' WHERE id=?").run(id);
  }

  failed(id: string, error: string): void {
    this.db.prepare("UPDATE tx_attempts SET status='FAILED', error=? WHERE id=?").run(error.slice(0, 500), id);
  }
}

