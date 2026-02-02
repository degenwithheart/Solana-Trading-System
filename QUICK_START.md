# Quick Start (Universal)

## Prereqs
- Node.js 20+
- npm 9+

## Setup

```bash
cd solana-trading-system
npm run install:all
npm run setup:env
npm run build:all
```

## Run (3 terminals)

```bash
cd solana-trading-system/system-2-signer && npm start
cd solana-trading-system/system-1-trading-node && npm start
cd solana-trading-system/system-3-web-ui && npm run dev
```
