# Runbook (Universal)

Primary requirement is **Node.js 20+**. Bash is optional.

## 1) Install dependencies

```bash
cd solana-trading-system
npm run install:all
```

## 2) Create local config from templates (cross-platform)

```bash
npm run setup:env
```

Then edit:
- `system-1-trading-node/config.json`
- `system-2-signer/.env` (set `PRIVATE_KEY` base58, and `API_KEY` if `REQUIRE_API_KEY=true`)
- `system-2-signer/policy.json` (add allowlisted program IDs; deny-by-default)
- `system-1-trading-node/.env` (set `API_KEY` if you want Trading Node → Signer auth)

Key config sections:
- `execution.venues` / `execution.venueOrder` (multi-venue routing)
- `profiles` + `activeProfile` (risk + exits presets)
- `controls` (defaults; runtime overrides via dashboard/API)
- `ai` (entry controller; requires enough trained samples before it can take control)

## 3) Build

```bash
npm run build:all
```

## 4) Run (3 terminals)

```bash
cd solana-trading-system/system-2-signer && npm start
cd solana-trading-system/system-1-trading-node && npm start
cd solana-trading-system/system-3-web-ui && npm run dev
```

Dashboard runs on `http://localhost:3002` by default.

## Production UI hardening

- Set `system-3-web-ui/.env.local`:
  - `UI_ACCESS_PASSWORD=...` (enables unlock gate)
  - `TRADING_NODE_API_KEY=...` (so the UI proxy adds `x-api-key`)
- Prefer `npm run build && npm start` for the UI (avoid `next dev` in production).

## 5) Add a candidate mint (manual discovery)

```bash
curl -X POST http://localhost:3000/candidates \
  -H 'content-type: application/json' \
  -d '{"mint":"<SPL_TOKEN_MINT_ADDRESS>"}'
```

## 6) Validate (Node-based, cross-platform)

```bash
npm run validate
```
