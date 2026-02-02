import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { createRequire } from "node:module";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[key] = val;
  }
  return out;
}

function readJsonFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text);
}

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();

  const jsonDir = path.resolve(root, args.jsonDir ?? path.join(root, "system-1-trading-node", "data"));
  const sqlitePath = path.resolve(root, args.dbPath ?? path.join(root, "system-1-trading-node", "data", "trading.db"));

  const candidatesPath = path.join(jsonDir, "candidates.json");
  const statePath = path.join(jsonDir, "state.json");

  if (!fs.existsSync(candidatesPath) && !fs.existsSync(statePath)) {
    throw new Error(`No legacy JSON found at ${jsonDir}`);
  }

  const require = createRequire(import.meta.url);
  // eslint-disable-next-line import/no-commonjs
  const Database = require("better-sqlite3");
  const db = new Database(sqlitePath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  // Apply minimal schema (same as db.ts migrations) to make migration runnable standalone.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
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
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_candidates_mint ON candidates(mint);
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
    CREATE TABLE IF NOT EXISTS risk_ledger (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      realized_pnl_sol REAL NOT NULL,
      circuit_breaker_trips INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_risk_ledger_date ON risk_ledger(date);
  `);

  const upsertCandidate = db.prepare(`
    INSERT INTO candidates(id, mint, source, status, first_seen_at, last_seen_at, first_seen_slot, last_seen_slot, score_reasons_json)
    VALUES(@id, @mint, @source, @status, @first_seen_at, @last_seen_at, @first_seen_slot, @last_seen_slot, '[]')
    ON CONFLICT(mint) DO UPDATE SET last_seen_at=excluded.last_seen_at
  `);
  const insertPosition = db.prepare(`
    INSERT OR REPLACE INTO positions(id, mint, opened_at, closed_at, size_sol, status, entry_signature, exit_signature, pnl_sol, notes)
    VALUES(@id, @mint, @opened_at, @closed_at, @size_sol, @status, @entry_signature, @exit_signature, @pnl_sol, @notes)
  `);
  const upsertLedger = db.prepare(`
    INSERT INTO risk_ledger(id, date, realized_pnl_sol, circuit_breaker_trips)
    VALUES(@id, @date, @realized_pnl_sol, @circuit_breaker_trips)
    ON CONFLICT(date) DO UPDATE SET realized_pnl_sol=excluded.realized_pnl_sol, circuit_breaker_trips=excluded.circuit_breaker_trips
  `);

  let importedCandidates = 0;
  let importedPositions = 0;

  db.transaction(() => {
    if (fs.existsSync(candidatesPath)) {
      const legacy = readJsonFile(candidatesPath);
      const list = Array.isArray(legacy.candidates) ? legacy.candidates : [];
      for (const c of list) {
        if (!c?.mint) continue;
        upsertCandidate.run({
          id: c.id ?? crypto.randomUUID(),
          mint: String(c.mint),
          source: String(c.source ?? "legacy"),
          status: "DISCOVERED",
          first_seen_at: String(c.discoveredAt ?? new Date().toISOString()),
          last_seen_at: new Date().toISOString(),
          first_seen_slot: null,
          last_seen_slot: null
        });
        importedCandidates++;
      }
    }

    if (fs.existsSync(statePath)) {
      const legacy = readJsonFile(statePath);
      const positions = Array.isArray(legacy.positions) ? legacy.positions : [];
      for (const p of positions) {
        if (!p?.id || !p?.mint) continue;
        insertPosition.run({
          id: String(p.id),
          mint: String(p.mint),
          opened_at: String(p.openedAt ?? new Date().toISOString()),
          closed_at: null,
          size_sol: Number(p.sizeSol ?? 0),
          status: String(p.status ?? "OPEN"),
          entry_signature: p.entrySignature ?? null,
          exit_signature: p.exitSignature ?? null,
          pnl_sol: p.pnlSol ?? null,
          notes: p.notes ?? null
        });
        importedPositions++;
      }

      if (legacy.risk?.date) {
        upsertLedger.run({
          id: crypto.randomUUID(),
          date: String(legacy.risk.date),
          realized_pnl_sol: Number(legacy.risk.realizedPnlSol ?? 0),
          circuit_breaker_trips: Number(legacy.risk.circuitBreakerTrips ?? 0)
        });
      }
    }
  })();

  // eslint-disable-next-line no-console
  console.log(`Migrated candidates=${importedCandidates} positions=${importedPositions} db=${sqlitePath}`);
}

main();
