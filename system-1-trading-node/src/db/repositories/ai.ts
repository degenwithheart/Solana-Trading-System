import type { Db } from "../db";

export type AiEntryRow = {
  entryId: string;
  featuresJson: string;
  action: string;
  controller: "system" | "ai";
  openedAt: number;
};

export type AiOutcomeRow = {
  entryId: string;
  reward: number;
  closedAt: number;
};

export type AiSampleRow = AiEntryRow & AiOutcomeRow;

export class AiEntriesRepo {
  constructor(private readonly db: Db) {}

  upsert(row: AiEntryRow): void {
    this.db
      .prepare(
        "INSERT INTO ai_entries(entry_id, features_json, action, controller, opened_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(entry_id) DO UPDATE SET features_json=excluded.features_json, action=excluded.action, controller=excluded.controller, opened_at=excluded.opened_at"
      )
      .run(row.entryId, row.featuresJson, row.action, row.controller, row.openedAt);
  }

  get(entryId: string): AiEntryRow | null {
    const r = this.db
      .prepare("SELECT entry_id, features_json, action, controller, opened_at FROM ai_entries WHERE entry_id=?")
      .get(entryId) as any;
    if (!r) return null;
    return {
      entryId: String(r.entry_id),
      featuresJson: String(r.features_json),
      action: String(r.action),
      controller: (String(r.controller) as any) === "ai" ? "ai" : "system",
      openedAt: Number(r.opened_at)
    };
  }
}

export class AiOutcomesRepo {
  constructor(private readonly db: Db) {}

  upsert(row: AiOutcomeRow): void {
    this.db
      .prepare(
        "INSERT INTO ai_outcomes(entry_id, reward, closed_at) VALUES(?, ?, ?) ON CONFLICT(entry_id) DO UPDATE SET reward=excluded.reward, closed_at=excluded.closed_at"
      )
      .run(row.entryId, row.reward, row.closedAt);
  }

  get(entryId: string): AiOutcomeRow | null {
    const r = this.db.prepare("SELECT entry_id, reward, closed_at FROM ai_outcomes WHERE entry_id=?").get(entryId) as any;
    if (!r) return null;
    return { entryId: String(r.entry_id), reward: Number(r.reward), closedAt: Number(r.closed_at) };
  }

  listSamplesClosedSince(sinceMs: number): AiSampleRow[] {
    const rows = this.db
      .prepare(
        `
        SELECT e.entry_id, e.features_json, e.action, e.controller, e.opened_at,
               o.reward, o.closed_at
        FROM ai_entries e
        JOIN ai_outcomes o ON o.entry_id = e.entry_id
        WHERE o.closed_at >= ?
        ORDER BY o.closed_at ASC
      `
      )
      .all(sinceMs) as any[];
    return rows.map((r) => ({
      entryId: String(r.entry_id),
      featuresJson: String(r.features_json),
      action: String(r.action),
      controller: (String(r.controller) as any) === "ai" ? "ai" : "system",
      openedAt: Number(r.opened_at),
      reward: Number(r.reward),
      closedAt: Number(r.closed_at)
    }));
  }
}

