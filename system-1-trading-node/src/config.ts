import fs from "node:fs";
import path from "node:path";
import { zTradingConfig } from "../../shared/schemas";
import type { TradingConfig } from "../../shared/types";

export function loadTradingConfig(opts: { dir: string; filename?: string }): TradingConfig {
  const name = opts.filename ?? "config.json";
  const filePath = path.join(opts.dir, name);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${name}. Create it from config.example.json (or run 'npm run setup:env').`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return zTradingConfig.parse(parsed) as TradingConfig;
}
