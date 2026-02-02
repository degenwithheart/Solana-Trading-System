import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-commonjs
const Database = require("better-sqlite3");

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

async function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const configPath = path.resolve(root, args.config ?? "system-1-trading-node/config.json");
  const limit = Number(args.limit ?? 200);

  if (!fs.existsSync(configPath)) throw new Error(`Missing config: ${configPath}`);
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const dbPath = path.resolve(root, cfg.storage?.sqlite?.path ?? "./data/trading.db");

  const db = new Database(dbPath);
  db.pragma("foreign_keys=ON");

  const sources = cfg.discovery?.sources ?? [];
  if (sources.length === 0) throw new Error("No discovery.sources configured");

  const endpoint = cfg.rpc?.endpoints?.[0]?.url;
  if (!endpoint) throw new Error("No rpc.endpoints configured");

  const { Connection, PublicKey } = await import("@solana/web3.js");
  const conn = new Connection(endpoint, { commitment: "confirmed", wsEndpoint: cfg.rpc?.wsEndpoints?.[0]?.url });

  const upsert = db.prepare(
    "INSERT INTO candidates(id, mint, source, status, first_seen_at, last_seen_at, first_seen_slot, last_seen_slot, score_reasons_json) VALUES(?, ?, ?, 'DISCOVERED', ?, ?, ?, ?, '[]') ON CONFLICT(mint) DO UPDATE SET last_seen_at=excluded.last_seen_at, last_seen_slot=excluded.last_seen_slot"
  );

  for (const src of sources) {
    if (!src.enabled) continue;
    const program = new PublicKey(src.programId);
    const sigs = await conn.getSignaturesForAddress(program, { limit: Math.max(1, limit) }, src.commitment ?? "confirmed");
    // oldest->newest
    for (const s of [...sigs].reverse()) {
      if (!s.signature) continue;
      const tx = await conn.getTransaction(s.signature, { commitment: src.commitment ?? "confirmed", maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages ?? [];
      const mints = extractPubkeys(logs.join("\n"), Number(src.maxMintsPerLog ?? 5));
      for (const mint of mints) {
        upsert.run(randomId(), mint, src.name, new Date().toISOString(), new Date().toISOString(), tx?.slot ?? null, tx?.slot ?? null);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`Replayed ${src.name}: signatures=${sigs.length}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Done. DB at ${dbPath}`);
}

function extractPubkeys(text, max) {
  const out = [];
  const re = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (out.length >= max) break;
    out.push(m[0]);
  }
  return [...new Set(out)];
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

await main();

