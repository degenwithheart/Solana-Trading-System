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
- `system-2-signer/.env` (set `PRIVATE_KEY` base58, and optionally `API_KEY`)
- `system-1-trading-node/.env` (set `API_KEY` if you want Trading Node → Signer auth)

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

## Optional: Bash scripts

If you have Bash 5+ (macOS with Homebrew bash, Linux, Git Bash/WSL), you can also use the provided `setup_project_advanced.sh` / `validate_and_test.sh` in the parent folder, but the project itself does not require Bash.

