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
  execution: {
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
