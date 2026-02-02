import type { Db } from "../db";

export class ActionDedupeRepo {
  constructor(private readonly db: Db) {}

  claim(key: string, ttlMs: number): boolean {
    const now = Date.now();
    this.prune(now);
    const expires = now + Math.max(0, ttlMs);
    try {
      this.db.prepare("INSERT INTO action_dedupe(key, expires_at) VALUES(?, ?)").run(key, expires);
      return true;
    } catch {
      return false;
    }
  }

  prune(now = Date.now()): void {
    this.db.prepare("DELETE FROM action_dedupe WHERE expires_at < ?").run(now);
  }
}

