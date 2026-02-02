export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet";

export type RpcEndpoint = {
  url: string;
  provider: string;
  priority: number;
  type: "http";
};

export type WsEndpoint = {
  url: string;
  provider: string;
  priority: number;
};

export type Platform = "universal" | "macos" | "linux" | "windows";

export type TradingConfig = {
  network: SolanaCluster;
  platform: Platform;
  constants: {
    wsolMint: string;
  };
  storage?: {
    sqlite?: {
      path: string;
      wal: boolean;
      busyTimeoutMs: number;
    };
  };
  discovery?: {
    enabled: boolean;
    sources: Array<{
      name: string;
      programId: string;
      commitment: "processed" | "confirmed" | "finalized";
      enabled: boolean;
      maxMintsPerLog: number;
    }>;
    backfill: {
      enabled: boolean;
      limitPerSource: number;
      concurrency: number;
    };
    dedupeTtlMs: number;
    maxCandidatesKept: number;
  };
  mode: "live" | "paper" | "shadow";
  paper: {
    initialSol: number;
    feeReserveSol: number;
  };
  governance: {
    mintBlocklist: string[];
    mintAllowlist: string[];
    maxAttemptsPerMintPerDay: number;
    cooldownMinutesPerMint: number;
  };
  mev: {
    maxQuoteDriftBps: number;
    maxPriceImpactPct: number;
    maxRouteSteps: number;
    requireFreshQuoteMs: number;
  };
  reconciliation: {
    enabled: boolean;
    intervalMs: number;
  };
  metrics: {
    enabled: boolean;
    path: string;
    promPath: string;
  };
  controls: {
    pauseDiscovery: boolean;
    pauseEntries: boolean;
    pauseExits: boolean;
    killSwitch: boolean;
  };
  execution: {
    venues: Array<{
      name: string;
      enabled: boolean;
      kind: "jupiter";
      allowedDexLabels: string[];
      onlyDirectRoutes: boolean;
      slippageBps: number;
      maxPriorityFeeLamports: number;
      maxRetries: number;
      confirmationTimeoutMs: number;
    }>;
    venueOrder: string[];
  };
  profiles: Record<
    string,
    {
      enabled: boolean;
      entry: {
        positionSizeFixedSol: number;
        positionSizeWalletPct: number;
        positionSizeMinSol: number;
        positionSizeMaxSol: number;
        maxOpenPositions: number;
      };
      exits: {
        stopLossPct: number;
        takeProfitLevels: Array<{ profitPct: number; sellPct: number }>;
        trailingStop: { enabled: boolean; activationProfitPct: number; trailingPct: number };
        maxHoldMinutes: number;
      };
    }
  >;
  activeProfile: string;
  rpc: {
    endpoints: RpcEndpoint[];
    wsEndpoints: WsEndpoint[];
    healthCheckIntervalMs: number;
    maxRetries: number;
    timeoutMs: number;
  };
  strategy: {
    entryMinConfidence: number;
    entryMinPumpProb: number;
    entryMaxRugProb: number;
    positionSizePercent: number;
    maxConcurrentPositions: number;
    exitTakeProfitPct: number;
    exitStopLossPct: number;
    exitTimeoutMinutes: number;
    enableTrailingStop: boolean;
    trailingStopPct: number;
  };
  risk: {
    maxTradeRiskSol: number;
    maxDailyLossSol: number;
    maxPositionSizeSol: number;
    maxConcurrentPositions: number;
    emergencyStopLossPct: number;
    maxDrawdownPct: number;
    enableCircuitBreaker: boolean;
    circuitBreakerThreshold: number;
  };
  filters: {
    minLiquiditySol: number;
    maxLiquiditySol: number;
    minVolume24hSol: number;
    maxTopHolderPct: number;
    requireFrozenAuthority: boolean;
    requireRevokedMintAuthority: boolean;
    minHolderCount: number;
    maxAgeHours: number;
  };
  // legacy field kept for compatibility; prefer `execution.venues[*]`.
  executionLegacy?: {
    slippageBps: number;
    priorityFeeLamports: number;
    maxRetries: number;
    confirmationTimeout: number;
  };
  notifications?: {
    macos?: {
      enabled: boolean;
      sound: boolean;
      onPositionOpen: boolean;
      onPositionClose: boolean;
      onAlert: boolean;
    };
  };
};

export type CandidateToken = {
  mint: string;
  discoveredAt: string;
  source: "programLogs" | "manual";
};

export type TokenFeatures = {
  mint: string;
  ageHours: number;
  holderCount: number;
  topHolderPct: number;
  liquiditySol: number;
  volume24hSol: number;
  hasFrozenAuthority: boolean;
  hasRevokedMintAuthority: boolean;
};

export type SignalScore = {
  mint: string;
  confidence: number;
  pumpProbability: number;
  rugProbability: number;
  reasons: string[];
};

export type Position = {
  id: string;
  mint: string;
  openedAt: string;
  sizeSol: number;
  entrySignature?: string;
  exitSignature?: string;
  status: "OPEN" | "CLOSED" | "FAILED";
  pnlSol?: number;
  notes?: string;
};

export type HealthStatus = {
  ok: boolean;
  service: string;
  version: string;
  timestamp: string;
};
