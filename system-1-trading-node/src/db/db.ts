import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { Logger } from "../utils/logger";

export type Db = Database.Database;

export type DbOptions = {
  filePath: string;
  wal: boolean;
  busyTimeoutMs: number;
};

export function openDb(opts: DbOptions, log: Logger): Db {
  fs.mkdirSync(path.dirname(opts.filePath), { recursive: true });
  const db = new Database(opts.filePath);
  db.pragma("foreign_keys = ON");
  if (opts.wal) db.pragma("journal_mode = WAL");
  db.pragma(`busy_timeout = ${Math.max(0, opts.busyTimeoutMs)}`);

  migrate(db, log);
  return db;
}

function migrate(db: Db, log: Logger): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set<number>(
    db.prepare("SELECT id FROM schema_migrations ORDER BY id").all().map((r: any) => Number(r.id))
  );

  const migrations: Array<{ id: number; sql: string }> = [
    {
      id: 1,
      sql: `
        CREATE TABLE IF NOT EXISTS candidates (
          id TEXT PRIMARY KEY,
          mint TEXT NOT NULL,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          first_seen_slot INTEGER,
          last_seen_slot INTEGER,
          score_confidence REAL,
          score_pump REAL,
          score_rug REAL,
          score_reasons_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_candidates_status_seen ON candidates(status, last_seen_at);
        CREATE UNIQUE INDEX IF NOT EXISTS uidx_candidates_mint ON candidates(mint);
      `
    },
    {
      id: 2,
      sql: `
        CREATE TABLE IF NOT EXISTS positions (
          id TEXT PRIMARY KEY,
          mint TEXT NOT NULL,
          opened_at TEXT NOT NULL,
          closed_at TEXT,
          size_sol REAL NOT NULL,
          status TEXT NOT NULL,
          entry_signature TEXT,
          exit_signature TEXT,
          pnl_sol REAL,
          notes TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
        CREATE INDEX IF NOT EXISTS idx_positions_mint ON positions(mint);
      `
    },
    {
      id: 3,
      sql: `
        CREATE TABLE IF NOT EXISTS tx_attempts (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          kind TEXT NOT NULL,
          mint TEXT,
          position_id TEXT,
          venue TEXT NOT NULL,
          amount_sol REAL,
          signature TEXT,
          status TEXT NOT NULL,
          error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tx_attempts_created ON tx_attempts(created_at);
      `
    },
    {
      id: 4,
      sql: `
        CREATE TABLE IF NOT EXISTS risk_ledger (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          realized_pnl_sol REAL NOT NULL,
          circuit_breaker_trips INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uidx_risk_ledger_date ON risk_ledger(date);
      `
    },
    {
      id: 5,
      sql: `
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `
    },
    {
      id: 6,
      sql: `
        ALTER TABLE positions ADD COLUMN entry_cost_sol REAL;
        ALTER TABLE positions ADD COLUMN entry_token_amount_raw TEXT;
        ALTER TABLE positions ADD COLUMN token_decimals INTEGER;
        ALTER TABLE positions ADD COLUMN entry_price_sol REAL;
        ALTER TABLE positions ADD COLUMN strategy_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE positions ADD COLUMN state_json TEXT NOT NULL DEFAULT '{}';
      `
    },
    {
      id: 7,
      sql: `
        CREATE TABLE IF NOT EXISTS mint_governance (
          mint TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          reason TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mint_governance_mode ON mint_governance(mode);
      `
    },
    {
      id: 8,
      sql: `
        CREATE TABLE IF NOT EXISTS action_dedupe (
          key TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_action_dedupe_expires ON action_dedupe(expires_at);
      `
    },
    {
      id: 9,
      sql: `
        CREATE TABLE IF NOT EXISTS paper_ledger (
          id TEXT PRIMARY KEY,
          ts TEXT NOT NULL,
          kind TEXT NOT NULL,
          mint TEXT,
          sol_delta REAL NOT NULL,
          note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_paper_ledger_ts ON paper_ledger(ts);
      `
    },
    {
      id: 10,
      sql: `
        CREATE TABLE IF NOT EXISTS paper_balances (
          mint TEXT PRIMARY KEY,
          amount_raw TEXT NOT NULL,
          decimals INTEGER NOT NULL
        );
      `
    },
    {
      id: 11,
      sql: `
        CREATE TABLE IF NOT EXISTS ai_entries (
          entry_id TEXT PRIMARY KEY,
          features_json TEXT NOT NULL,
          action TEXT NOT NULL,
          controller TEXT NOT NULL,
          opened_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_entries_opened_at ON ai_entries(opened_at);
        CREATE INDEX IF NOT EXISTS idx_ai_entries_controller ON ai_entries(controller);

        CREATE TABLE IF NOT EXISTS ai_outcomes (
          entry_id TEXT PRIMARY KEY,
          reward REAL NOT NULL,
          closed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_outcomes_closed_at ON ai_outcomes(closed_at);
      `
    }
  ];

  const insertMigration = db.prepare("INSERT INTO schema_migrations(id, applied_at) VALUES(?, ?)");
  const now = () => new Date().toISOString();

  db.transaction(() => {
    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      db.exec(m.sql);
      insertMigration.run(m.id, now());
      log.info("db_migrated", { id: m.id });
    }
  })();
}
