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
- `system-3-web-ui/.env.local`

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
