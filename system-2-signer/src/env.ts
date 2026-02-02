import { z } from "zod";
import { zEnvBool } from "../../shared/schemas";

const zLogLevel = z.enum(["debug", "info", "warn", "error"]);

export const zEnv = z.object({
  NODE_ENV: z.string().default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("127.0.0.1"),

  PRIVATE_KEY: z.string().optional().default(""),
  PUBLIC_KEY: z.string().optional().default(""),

  MAX_TRANSACTIONS_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  MAX_TRANSACTIONS_PER_HOUR: z.coerce.number().int().min(1).default(100),
  MAX_TRANSACTIONS_PER_DAY: z.coerce.number().int().min(1).default(500),

  ENABLE_PROGRAM_ALLOWLIST: zEnvBool.default(false),
  ALLOWED_PROGRAMS: z.string().optional().default(""),
  ENABLE_AMOUNT_LIMITS: zEnvBool.default(true),
  MAX_TRANSACTION_AMOUNT_SOL: z.coerce.number().min(0).default(10),

  ENABLE_IP_ALLOWLIST: zEnvBool.default(true),
  ALLOWED_IPS: z.string().default("127.0.0.1,::1"),
  REQUIRE_API_KEY: zEnvBool.default(true),
  API_KEY: z.string().optional().default(""),

  USE_KEYCHAIN: zEnvBool.default(false),
  KEYCHAIN_SERVICE: z.string().default("solana-trading-signer-private-key"),

  LOG_LEVEL: zLogLevel.default("info"),
  LOG_FILE: z.string().default("./logs/signer.log"),
  LOG_MAX_SIZE_MB: z.coerce.number().int().min(1).default(50),
  LOG_MAX_FILES: z.coerce.number().int().min(1).default(10),
  LOG_CONSOLE: zEnvBool.default(true),
  LOG_TRANSACTIONS: zEnvBool.default(true),

  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),
  SIGNATURE_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000)
});

export type SignerEnv = z.infer<typeof zEnv>;

export function readEnv(processEnv: NodeJS.ProcessEnv): SignerEnv {
  return zEnv.parse(processEnv);
}

