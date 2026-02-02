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
  constants: z.object({
    wsolMint: z.string().min(32)
  }),
  storage: z
    .object({
      sqlite: z
        .object({
          path: z.string().min(1).default("./data/trading.db"),
          wal: z.boolean().default(true),
          busyTimeoutMs: z.number().int().min(0).default(5000)
        })
        .default({ path: "./data/trading.db", wal: true, busyTimeoutMs: 5000 })
    })
    .optional(),
  discovery: z
    .object({
      enabled: z.boolean().default(true),
      sources: z
        .array(
          z.object({
            name: z.string().min(1),
            programId: z.string().min(32),
            commitment: z.enum(["processed", "confirmed", "finalized"]).default("confirmed"),
            enabled: z.boolean().default(true),
            maxMintsPerLog: z.number().int().min(1).max(50).default(5)
          })
        )
        .default([]),
      backfill: z
        .object({
          enabled: z.boolean().default(true),
          limitPerSource: z.number().int().min(1).max(5000).default(500),
          concurrency: z.number().int().min(1).max(25).default(5)
        })
        .default({ enabled: true, limitPerSource: 500, concurrency: 5 }),
      dedupeTtlMs: z.number().int().min(1_000).default(60_000),
      maxCandidatesKept: z.number().int().min(100).max(100_000).default(10_000)
    })
    .optional(),
  mode: z.enum(["live", "paper", "shadow"]),
  paper: z.object({
    initialSol: z.number().min(0),
    feeReserveSol: z.number().min(0)
  }),
  governance: z.object({
    mintBlocklist: z.array(z.string().min(32)),
    mintAllowlist: z.array(z.string().min(32)),
    maxAttemptsPerMintPerDay: z.number().int().min(0).max(1000),
    cooldownMinutesPerMint: z.number().int().min(0).max(7 * 24 * 60)
  }),
  mev: z.object({
    maxQuoteDriftBps: z.number().int().min(0).max(10000),
    maxPriceImpactPct: z.number().min(0).max(100),
    maxRouteSteps: z.number().int().min(1).max(50),
    requireFreshQuoteMs: z.number().int().min(0).max(600000)
  }),
  reconciliation: z.object({
    enabled: z.boolean(),
    intervalMs: z.number().int().min(1000).max(3600000)
  }),
  metrics: z.object({
    enabled: z.boolean(),
    path: z.string().min(1),
    promPath: z.string().min(1)
  }),
  controls: z.object({
    pauseDiscovery: z.boolean(),
    pauseEntries: z.boolean(),
    pauseExits: z.boolean(),
    killSwitch: z.boolean()
  }),
  execution: z.object({
    venues: z
      .array(
        z.object({
          name: z.string().min(1),
          enabled: z.boolean(),
          kind: z.literal("jupiter"),
          allowedDexLabels: z.array(z.string().min(1)),
          onlyDirectRoutes: z.boolean(),
          slippageBps: z.number().int().min(0).max(100000),
          maxPriorityFeeLamports: z.number().int().min(0),
          maxRetries: z.number().int().min(0).max(25),
          confirmationTimeoutMs: z.number().int().min(1000).max(300000)
        })
      )
      .min(1),
    venueOrder: z.array(z.string().min(1)).min(1)
  }),
  profiles: z.record(
    z.object({
      enabled: z.boolean(),
      entry: z.object({
        positionSizeFixedSol: z.number().min(0),
        positionSizeWalletPct: z.number().min(0).max(100),
        positionSizeMinSol: z.number().min(0),
        positionSizeMaxSol: z.number().min(0),
        maxOpenPositions: z.number().int().min(0).max(100)
      }),
      exits: z.object({
        stopLossPct: z.number().min(0).max(1000),
        takeProfitLevels: z.array(z.object({ profitPct: z.number().min(0).max(10000), sellPct: z.number().min(0).max(100) })),
        trailingStop: z.object({
          enabled: z.boolean(),
          activationProfitPct: z.number().min(0).max(10000),
          trailingPct: z.number().min(0).max(10000)
        }),
        maxHoldMinutes: z.number().int().min(1).max(365 * 24 * 60)
      })
    })
  ),
  activeProfile: z.string().min(1),
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
  executionLegacy: z
    .object({
      slippageBps: z.number().int().min(0).max(100000),
      priorityFeeLamports: z.number().int().min(0),
      maxRetries: z.number().int().min(0),
      confirmationTimeout: z.number().int().min(1000)
    })
    .optional(),
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
