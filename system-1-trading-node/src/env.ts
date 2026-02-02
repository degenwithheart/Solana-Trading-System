import { z } from "zod";
import { zEnvBool } from "../../shared/schemas";

const zLogLevel = z.enum(["debug", "info", "warn", "error"]);

export const zEnv = z.object({
  NODE_ENV: z.string().default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),

  SIGNER_URL: z.string().url().default("http://localhost:3001"),
  SIGNER_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  SIGNER_RETRY_ATTEMPTS: z.coerce.number().int().min(0).default(3),

  SOLANA_RPC_HTTP: z.string().url().optional(),
  SOLANA_RPC_WS: z.string().url().optional(),

  STORAGE_PATH: z.string().default("./data"),
  STORAGE_MAX_SIZE_MB: z.coerce.number().int().min(1).default(1000),

  LOG_LEVEL: zLogLevel.default("info"),
  LOG_FILE: z.string().default("./logs/trading-node.log"),
  LOG_MAX_SIZE_MB: z.coerce.number().int().min(1).default(100),
  LOG_MAX_FILES: z.coerce.number().int().min(1).default(10),
  LOG_CONSOLE: zEnvBool.default(true),

  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).default(10),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),

  API_KEY: z.string().optional().default(""),
  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),

  ENABLE_WEBSOCKET: zEnvBool.default(true),
  ENABLE_METRICS: zEnvBool.default(true),
  ENABLE_DEBUG_ENDPOINTS: zEnvBool.default(false),

  PROCESS_PRIORITY: z.coerce.number().int().min(-20).max(20).default(0),
  USE_FSEVENTS: zEnvBool.default(true),

  // Market data and execution (real endpoints, no mock data).
  JUPITER_BASE_URL: z.string().url().default("https://quote-api.jup.ag"),
  JUPITER_PRICE_URL: z.string().url().default("https://price.jup.ag/v6/price")
});

export type TradingEnv = z.infer<typeof zEnv>;

export function readEnv(processEnv: NodeJS.ProcessEnv): TradingEnv {
  return zEnv.parse(processEnv);
}

