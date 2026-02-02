# Solana Trading System (Universal)

This repository contains three cooperating services:

1. **System 1 – Trading Node** (`system-1-trading-node`): Orchestrates discovery, scoring, risk, and execution.
2. **System 2 – Signer** (`system-2-signer`): Holds the private key and signs transactions. **Binds to localhost only.**
3. **System 3 – Web UI** (`system-3-web-ui`): Next.js dashboard for status, logs, and positions.

## Quick start

```bash
cd solana-trading-system
npm run install:all
npm run setup:env
```

Configure:
- `system-1-trading-node/.env`
- `system-1-trading-node/config.json` (copy from `config.example.json`)
- `system-2-signer/.env` (**chmod 600**)
- `system-2-signer/policy.json` (deny-by-default allowlist)
- `system-3-web-ui/.env.local`

Main knobs live in `system-1-trading-node/config.json`:
- `execution.venues` / `execution.venueOrder` (Jupiter multi-venue attempts)
- `profiles` + `activeProfile` (position sizing + TP/SL/trailing/time exits)
- `controls` (defaults; runtime overrides via `/controls`)
- `ai` (degen entry controller; deterministic, local, auditable)

## UI security

Set `UI_ACCESS_PASSWORD` in `system-3-web-ui/.env.local` to require an unlock password before any pages *or API proxy routes* work.

To protect Trading Node API calls from the browser, set `TRADING_NODE_API_KEY` in `system-3-web-ui/.env.local` and set matching `API_KEY` in `system-1-trading-node/.env`.

## React2Shell / SSR hardening note

This UI is designed to avoid server-side command execution entirely and uses a strict CSP, plus an allowlisted API proxy. For production, run the UI with `next build` + `next start` (not `next dev`) and keep dependencies updated.

Build:

```bash
npm run build:all
```

Run (3 terminals):

```bash
cd system-2-signer && npm start
cd ../system-1-trading-node && npm start
cd ../system-3-web-ui && npm run dev
```

## Security model

- The trading node never stores private keys.
- The signer enforces:
  - localhost binding
  - optional API key
  - IP allowlist
  - transaction allowlist / amount limits (configurable)
- Do not commit `.env` files.

## Validation

Run:

```bash
npm run validate
```
