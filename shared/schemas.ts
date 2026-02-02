import { z } from "zod";

export const zEnvBool = z
  .string()
  .optional()
  .transform((v) => (v ?? "").toLowerCase())
  .refine((v) => v === "" || v === "true" || v === "false", "Expected boolean string")
  .transform((v) => (v === "true" ? true : v === "false" ? false : undefined));

export const zSolanaCluster = z.enum(["mainnet-beta", "devnet", "testnet"]);

export const zTradingConfig = z.object({
  network: zSolanaCluster,
  platform: z.enum(["universal", "macos", "linux", "windows"]).default("universal"),
  rpc: z.object({
    endpoints: z
      .array(
        z.object({
          url: z.string().url(),
          provider: z.string().min(1),
          priority: z.number().int().min(1),
          type: z.literal("http")
        })
      )
      .min(1),
    wsEndpoints: z
      .array(
        z.object({
          url: z.string().url(),
          provider: z.string().min(1),
          priority: z.number().int().min(1)
        })
      )
      .min(1),
    healthCheckIntervalMs: z.number().int().min(1000),
    maxRetries: z.number().int().min(0),
    timeoutMs: z.number().int().min(1000)
  }),
  strategy: z.object({
    entryMinConfidence: z.number().min(0).max(1),
    entryMinPumpProb: z.number().min(0).max(1),
    entryMaxRugProb: z.number().min(0).max(1),
    positionSizePercent: z.number().min(0.1).max(100),
    maxConcurrentPositions: z.number().int().min(1).max(100),
    exitTakeProfitPct: z.number().min(0).max(1000),
    exitStopLossPct: z.number().min(0).max(1000),
    exitTimeoutMinutes: z.number().int().min(1),
    enableTrailingStop: z.boolean(),
    trailingStopPct: z.number().min(0).max(1000)
  }),
  risk: z.object({
    maxTradeRiskSol: z.number().min(0),
    maxDailyLossSol: z.number().min(0),
    maxPositionSizeSol: z.number().min(0),
    maxConcurrentPositions: z.number().int().min(1).max(100),
    emergencyStopLossPct: z.number().min(0).max(1000),
    maxDrawdownPct: z.number().min(0).max(1000),
    enableCircuitBreaker: z.boolean(),
    circuitBreakerThreshold: z.number().int().min(1).max(1000)
  }),
  filters: z.object({
    minLiquiditySol: z.number().min(0),
    maxLiquiditySol: z.number().min(0),
    minVolume24hSol: z.number().min(0),
    maxTopHolderPct: z.number().min(0).max(100),
    requireFrozenAuthority: z.boolean(),
    requireRevokedMintAuthority: z.boolean(),
    minHolderCount: z.number().int().min(0),
    maxAgeHours: z.number().min(0)
  }),
  execution: z.object({
    slippageBps: z.number().int().min(0).max(100000),
    priorityFeeLamports: z.number().int().min(0),
    maxRetries: z.number().int().min(0),
    confirmationTimeout: z.number().int().min(1000)
  }),
  notifications: z
    .object({
      macos: z
        .object({
          enabled: z.boolean(),
          sound: z.boolean(),
          onPositionOpen: z.boolean(),
          onPositionClose: z.boolean(),
          onAlert: z.boolean()
        })
        .optional()
    })
    .optional()
});
