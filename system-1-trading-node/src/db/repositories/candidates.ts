import crypto from "node:crypto";
import type { Db } from "../db";

export type CandidateStatus = "DISCOVERED" | "ENRICHED" | "SCORED" | "QUEUED_FOR_ENTRY" | "REJECTED" | "EXPIRED";

export type CandidateRow = {
  id: string;
  mint: string;
  source: string;
  status: CandidateStatus;
  first_seen_at: string;
  last_seen_at: string;
  first_seen_slot: number | null;
  last_seen_slot: number | null;
  score_confidence: number | null;
  score_pump: number | null;
  score_rug: number | null;
  score_reasons_json: string;
};

export class CandidateRepo {
  constructor(private readonly db: Db) {}

  upsertDiscovered(opts: { mint: string; source: string; slot?: number | null; nowIso?: string }): CandidateRow {
    const now = opts.nowIso ?? new Date().toISOString();
    const slot = opts.slot ?? null;
    const existing = this.db
      .prepare("SELECT * FROM candidates WHERE mint = ? LIMIT 1")
      .get(opts.mint) as CandidateRow | undefined;
    if (existing) {
      this.db
        .prepare(
          "UPDATE candidates SET last_seen_at = ?, last_seen_slot = ?, status = CASE WHEN status='REJECTED' THEN status ELSE 'DISCOVERED' END WHERE id = ?"
        )
        .run(now, slot, existing.id);
      return this.getByMint(opts.mint)!;
    }

    const id = crypto.randomUUID();
    this.db
      .prepare(
        "INSERT INTO candidates(id, mint, source, status, first_seen_at, last_seen_at, first_seen_slot, last_seen_slot, score_reasons_json) VALUES(?, ?, ?, 'DISCOVERED', ?, ?, ?, ?, '[]')"
      )
      .run(id, opts.mint, opts.source, now, now, slot, slot);
    return this.getById(id)!;
  }

  getById(id: string): CandidateRow | null {
    return (this.db.prepare("SELECT * FROM candidates WHERE id = ?").get(id) as CandidateRow | undefined) ?? null;
  }

  getByMint(mint: string): CandidateRow | null {
    return (this.db.prepare("SELECT * FROM candidates WHERE mint = ?").get(mint) as CandidateRow | undefined) ?? null;
  }

  listRecent(limit: number): CandidateRow[] {
    return this.db
      .prepare("SELECT * FROM candidates ORDER BY last_seen_at DESC LIMIT ?")
      .all(Math.max(1, limit)) as CandidateRow[];
  }

  removeByMint(mint: string): void {
    this.db.prepare("DELETE FROM candidates WHERE mint = ?").run(mint);
  }

  markScored(opts: {
    mint: string;
    confidence: number;
    pump: number;
    rug: number;
    reasons: string[];
  }): void {
    this.db
      .prepare(
        "UPDATE candidates SET status='SCORED', score_confidence=?, score_pump=?, score_rug=?, score_reasons_json=? WHERE mint=?"
      )
      .run(opts.confidence, opts.pump, opts.rug, JSON.stringify(opts.reasons), opts.mint);
  }
}

