# FEATURES

This document lists **implemented** features in this repository and a short functional summary of each.

## System 1 — Trading Node (`system-1-trading-node`)

### Local SQLite persistence (no server)
- Stores candidates, positions, tx attempts, risk ledger, governance rules, settings, paper ledger, and paper balances in a local SQLite file.
- Auto-migrates schema on startup.
- Files:
  - `solana-trading-system/system-1-trading-node/src/db/db.ts`
  - `solana-trading-system/system-1-trading-node/src/db/repositories/*`

### DB-backed candidates + lifecycle fields
- Candidates are stored in SQLite and updated on discovery and scoring.
- Exposes candidates via API.
- Files:
  - `solana-trading-system/system-1-trading-node/src/db/repositories/candidates.ts`
  - `solana-trading-system/system-1-trading-node/src/chain/discovery.ts`
  - `solana-trading-system/system-1-trading-node/src/api-server.ts`

### Trading Node API server (auth + rate limits + WebSocket status)
- Optional `x-api-key` authentication (all routes except `/health`) and in-memory IP-based rate limiting.
- CORS origin is config-driven (`CORS_ORIGIN`) and the server disables `x-powered-by`.
- Optional WebSocket status stream on `/ws` with heartbeat updates.
- Files:
  - `solana-trading-system/system-1-trading-node/src/api-server.ts`

### On-chain log discovery with checkpointed backfill
- Subscribes to program logs for configured sources (`discovery.sources`).
- Extracts candidate mint-like pubkeys from log text and upserts as candidates.
- Backfills missed history using `getSignaturesForAddress` checkpoints persisted in SQLite settings.
- Files:
  - `solana-trading-system/system-1-trading-node/src/discovery/log-discovery.ts`
  - `solana-trading-system/system-1-trading-node/src/db/repositories/settings.ts`

### Deterministic scoring + rule decision path
- Builds features from chain, then produces deterministic confidence/pump/rug scores with explainable reasons.
- Persists score fields for each candidate in SQLite.
- Files:
  - `solana-trading-system/system-1-trading-node/src/features/feature-engine.ts`
  - `solana-trading-system/system-1-trading-node/src/ml/model-client.ts`
  - `solana-trading-system/system-1-trading-node/src/filters/filter-system.ts`
  - `solana-trading-system/system-1-trading-node/src/strategy/strategy-engine.ts`
  - `solana-trading-system/system-1-trading-node/src/orchestrator.ts`

### Degen AI Entry Controller (linear contextual bandit)
- Observes every entry the system takes, logs the exact feature snapshot + chosen action (`profile:<name>`) and who controlled it (`system` or `ai`).
- When enabled and trained, controls only entry decisions: chooses `skip` or selects an existing configured profile (never invents profiles).
- Learns online only from the system’s own realized PnL at full close (reward shaped by hold time + max drawdown) with recency bias and epsilon-greedy exploration.
- Includes an AI-only rolling 24h loss circuit breaker that disables AI control automatically.
- Files:
  - `solana-trading-system/system-1-trading-node/src/ai/degen-policy.ts`
  - `solana-trading-system/system-1-trading-node/src/ai/model-store.ts`
  - `solana-trading-system/system-1-trading-node/src/ai/bootstrap.ts`
  - `solana-trading-system/system-1-trading-node/src/ai/reward.ts`
  - `solana-trading-system/system-1-trading-node/src/ai/stats.ts`
  - `solana-trading-system/system-1-trading-node/src/db/repositories/ai.ts`

### Multi-venue execution (Jupiter-based routing attempts)
- Executes swaps through Jupiter Quote/Swap APIs.
- Attempts venues in configured order (`execution.venueOrder`), where each venue can:
  - restrict allowed DEX labels (`allowedDexLabels`)
  - require direct routes (`onlyDirectRoutes`)
  - set slippage, priority fee cap, retries, and confirmation timeout
- Tracks each attempt in SQLite (`tx_attempts`) with status and error.
- Notes:
  - “Raydium/Orca/Pumpfun” selection is supported via Jupiter route label filtering and direct-route preference (not separate custom on-chain swap builders).
- Files:
  - `solana-trading-system/system-1-trading-node/src/execution/jupiter-executor.ts`
  - `solana-trading-system/system-1-trading-node/src/orchestrator.ts`
  - `solana-trading-system/system-1-trading-node/src/db/repositories/tx-attempts.ts`

### MEV/route safety guards (quote-time)
- Enforces configurable quote guards:
  - max route steps
  - max price impact
  - max quote drift (double-quote drift check)
- Files:
  - `solana-trading-system/system-1-trading-node/src/execution/jupiter-executor.ts`
  - `solana-trading-system/system-1-trading-node/config.example.json`

### Entry sizing via profiles (config-driven)
- Uses `profiles[activeProfile].entry` to compute:
  - fixed SOL size + wallet % size
  - min/max clamps
  - max open positions
- Files:
  - `solana-trading-system/system-1-trading-node/src/orchestrator.ts`
  - `solana-trading-system/system-1-trading-node/config.example.json`

### Exit engine (TP ladder / SL / trailing / time stop)
- Continuously evaluates open positions and triggers exits based on:
  - stop-loss %
  - take-profit ladder (partial sells)
  - trailing stop (activation + trail %)
  - max hold time (minutes)
- Executes sells using the same multi-venue Jupiter attempt list.
- Computes realized PnL deltas and writes to risk ledger.
- Uses Jupiter price API (token USD / SOL USD) to compute a SOL-denominated mark price for exit logic.
- Files:
  - `solana-trading-system/system-1-trading-node/src/exit/exit-engine.ts`
  - `solana-trading-system/system-1-trading-node/src/market/jupiter-price.ts`

### Reconciliation loop (truth-from-chain backfill)
- For live mode, backfills missing entry fields (entry cost / tokens / decimals / entry price) from confirmed transaction meta.
- Tracks current token balance per position in position `state_json`.
- Files:
  - `solana-trading-system/system-1-trading-node/src/reconciliation/reconciler.ts`
  - `solana-trading-system/system-1-trading-node/src/chain/tx-deltas.ts`
  - `solana-trading-system/system-1-trading-node/src/chain/token-utils.ts`

### Modes: live / paper / shadow
- `mode=live`: executes real swaps and reconciles from chain.
- `mode=paper`: simulates buys/sells using Jupiter quotes and maintains:
  - paper SOL balance via `paper_ledger`
  - paper token balances via `paper_balances`
- `mode=shadow`: exercises routing logic without sending transactions.
- Files:
  - `solana-trading-system/system-1-trading-node/src/orchestrator.ts`
  - `solana-trading-system/system-1-trading-node/src/db/repositories/paper-ledger.ts`

### Governance (per-mint allow/block) + limits
- Supports allow/block rules in SQLite plus config allow/block lists.
- Enforces:
  - config blocklist/allowlist
  - per-mint cooldown (minutes)
  - per-mint attempt cap (bucketed by day)
- Files:
  - `solana-trading-system/system-1-trading-node/src/db/repositories/governance.ts`
  - `solana-trading-system/system-1-trading-node/src/db/repositories/action-dedupe.ts`
  - `solana-trading-system/system-1-trading-node/src/orchestrator.ts`
  - `solana-trading-system/system-1-trading-node/src/api-server.ts`

### Runtime controls (DB-backed)
- Runtime toggles persisted in SQLite settings:
  - `pauseDiscovery`, `pauseEntries`, `pauseExits`, `killSwitch`
  - `activeProfile` override
- Exposed via API endpoints and controllable from the dashboard.
- Files:
  - `solana-trading-system/system-1-trading-node/src/controls/controls.ts`
  - `solana-trading-system/system-1-trading-node/src/api-server.ts`

### Metrics endpoints (JSON + Prometheus text)
- When enabled by config, exposes:
  - JSON metrics (`metrics.path`)
  - Prometheus-style plain text (`metrics.promPath`)
- Includes mode/open positions/candidate count and paper SOL balance in paper mode.
- Files:
  - `solana-trading-system/system-1-trading-node/src/api-server.ts`

### RPC robustness (provider scoring)
- Chooses HTTP endpoints based on priority + observed failures + latency.
- Tries endpoints in order during health checks and records success/failure signals.
- Files:
  - `solana-trading-system/system-1-trading-node/src/rpc/rpc-manager.ts`

### Replay harness (chain-to-DB)
- Fetches historical program signatures for configured discovery sources and populates candidates in SQLite.
- CLI: `npm run replay -- --config system-1-trading-node/config.json --limit 200`
- File:
  - `solana-trading-system/scripts/replay.mjs`

### One-time legacy JSON → SQLite migration
- Imports legacy `candidates.json` + `state.json` into the SQLite schema (keeps JSON support as a one-time migration path).
- CLI: `npm run migrate:json -- --jsonDir solana-trading-system/system-1-trading-node/data`
- File:
  - `solana-trading-system/scripts/migrate-json-to-sqlite.mjs`

## System 2 — Signer (`system-2-signer`)

### Localhost-only signing service
- Refuses to bind to non-localhost hosts.
- File:
  - `solana-trading-system/system-2-signer/src/index.ts`

### Deny-by-default policy file (`policy.json`)
- Loads a config-driven signer policy:
  - deny-by-default allowlist of program IDs
  - hard limits: lamports outflow, compute unit price, compute unit limit
  - require signer to be fee payer
  - optional instruction deny list (discriminator-based)
- Files:
  - `solana-trading-system/system-2-signer/src/policy.ts`
  - `solana-trading-system/system-2-signer/src/tx-validate.ts`
  - `solana-trading-system/system-2-signer/policy.example.json`

### Auth + rate limiting + IP allowlist
- Requires `x-api-key` when enabled.
- Enforces IP allowlist and request rate limits.
- File:
  - `solana-trading-system/system-2-signer/src/index.ts`

### macOS Keychain support (optional)
- If enabled, reads the private key from macOS Keychain.
- File:
  - `solana-trading-system/system-2-signer/src/keypair.ts`

## System 3 — Web UI (`system-3-web-ui`)

### Protected UI unlock gate (password overlay)
- If `UI_ACCESS_PASSWORD` is set, all pages and API routes require unlock.
- Uses an httpOnly cookie (`ui_auth=1`) after successful unlock.
- Files:
  - `solana-trading-system/system-3-web-ui/middleware.ts`
  - `solana-trading-system/system-3-web-ui/src/app/unlock/page.tsx`
  - `solana-trading-system/system-3-web-ui/src/app/api/unlock/route.ts`

### Secure API proxy to Trading Node
- Dashboard calls `"/api/trading/*"` which proxies to the Trading Node.
- Proxy is:
  - path-allowlisted (small surface area)
  - same-origin enforced for mutating requests (CSRF mitigation)
  - optionally adds Trading Node API key header (`TRADING_NODE_API_KEY`)
- File:
  - `solana-trading-system/system-3-web-ui/src/app/api/trading/[...path]/route.ts`

### Toast notifications
- Provides accessible toast notifications for UI actions (control updates, unlock, governance edits).
- Files:
  - `solana-trading-system/system-3-web-ui/src/ui/toast.tsx`
  - `solana-trading-system/system-3-web-ui/src/components/controls-panel.tsx`
  - `solana-trading-system/system-3-web-ui/src/app/unlock/unlock-form.tsx`

### Glassmorphism theme + light/dark modes
- Light/dark modes via `next-themes` and CSS variables.
- Mobile-first responsive layout.
- Files:
  - `solana-trading-system/system-3-web-ui/src/app/globals.css`
  - `solana-trading-system/system-3-web-ui/src/ui/theme.tsx`
  - `solana-trading-system/system-3-web-ui/src/components/theme-toggle.tsx`
  - `solana-trading-system/system-3-web-ui/src/app/layout.tsx`

### Controls UI + governance UI
- Controls: pause discovery/entries/exits, kill switch, close-all, profile switching.
- Governance: add/remove mint allow/block rules.
- Files:
  - `solana-trading-system/system-3-web-ui/src/components/controls-panel.tsx`
  - `solana-trading-system/system-3-web-ui/src/components/governance-panel.tsx`

### Security headers + CSP
- Adds CSP and common browser hardening headers.
- File:
  - `solana-trading-system/system-3-web-ui/next.config.js`

## Shared / Tooling

### Strong config validation
- Zod schema for config.json ensures required fields exist and are typed.
- Files:
  - `solana-trading-system/shared/schemas.ts`
  - `solana-trading-system/shared/types.ts`

### Cross-platform setup + validation scripts
- `npm run setup:env` creates missing env/config files and merges new defaults into an existing `config.json`.
- `npm run validate` checks structure and basic safety invariants.
- Files:
  - `solana-trading-system/scripts/setup-env.mjs`
  - `solana-trading-system/scripts/validate.mjs`
