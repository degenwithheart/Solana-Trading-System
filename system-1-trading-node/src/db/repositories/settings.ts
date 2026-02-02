import type { Db } from "../db";

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as any;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .run(key, value, now);
  }
}

