import { PublicKey } from "@solana/web3.js";
import type { TradingConfig } from "../../shared/types";
import type { TradingEnv } from "./env";
import { DiscoveryService } from "./chain/discovery";
import { ChainIntelligence } from "./chain/intelligence";
import { FeatureEngine } from "./features/feature-engine";
import { FilterSystem } from "./filters/filter-system";
import { ModelClient } from "./ml/model-client";
import { StrategyEngine } from "./strategy/strategy-engine";
import { RiskManager } from "./risk/risk-manager";
import { Logger } from "./utils/logger";
import { RpcManager } from "./rpc/rpc-manager";
import { SignerClient } from "./execution/signer-client";
import { JupiterExecutor } from "./execution/jupiter-executor";

export type OrchestratorStatus = {
  running: boolean;
  lastTickAt?: string;
  lastError?: string;
  candidates: number;
  openPositions: number;
};

export class Orchestrator {
  private running = false;
  private status: OrchestratorStatus = { running: false, candidates: 0, openPositions: 0 };
  private loopPromise: Promise<void> | null = null;

  private readonly filter: FilterSystem;
  private readonly features = new FeatureEngine();
  private readonly model = new ModelClient();
  private readonly strategy: StrategyEngine;
  private readonly signer: SignerClient;
  private readonly executor: JupiterExecutor;

  constructor(
    private readonly deps: {
      env: TradingEnv;
      cfg: TradingConfig;
      log: Logger;
      rpc: RpcManager;
      discovery: DiscoveryService;
      intelligence: ChainIntelligence;
      risk: RiskManager;
    }
  ) {
    this.filter = new FilterSystem(deps.cfg.filters);
    this.strategy = new StrategyEngine(deps.cfg.strategy);
    this.signer = new SignerClient({
      baseUrl: deps.env.SIGNER_URL,
      timeoutMs: deps.env.SIGNER_TIMEOUT_MS,
      retries: deps.env.SIGNER_RETRY_ATTEMPTS,
      apiKey: deps.env.API_KEY || undefined
    });
    this.executor = new JupiterExecutor({
      baseUrl: deps.env.JUPITER_BASE_URL,
      config: deps.cfg.execution,
      signer: this.signer
    });
  }

  getStatus(): OrchestratorStatus {
    const positions = this.deps.risk.listPositions();
    const open = positions.filter((p) => p.status === "OPEN").length;
    const candidates = this.deps.discovery.list().length;
    this.status = { ...this.status, candidates, openPositions: open, running: this.running };
    return this.status;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.status = { running: true, candidates: 0, openPositions: 0 };
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = null;
  }

  async tickOnce(): Promise<void> {
    await this.tick();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      await this.tick().catch((e) => {
        this.status.lastError = e instanceof Error ? e.message : "unknown_error";
        this.deps.log.error("tick_failed", { error: this.status.lastError });
        this.deps.risk.tripCircuitBreaker();
      });
      await sleep(this.deps.env.HEARTBEAT_INTERVAL_MS);
    }
  }

  private async tick(): Promise<void> {
    this.status.lastTickAt = new Date().toISOString();
    const candidates = this.deps.discovery.list();
    this.status.candidates = candidates.length;

    if (candidates.length === 0) return;

    const positions = this.deps.risk.listPositions();
    const openPositions = positions.filter((p) => p.status === "OPEN");
    this.status.openPositions = openPositions.length;

    const canOpen = this.deps.risk.canOpenPosition(openPositions.length);
    if (!canOpen.ok) return;

    const candidate = candidates[0]; // deterministic ordering
    const feats = await this.deps.intelligence.getFeatures(candidate.mint);
    const filterRes = this.filter.evaluate(feats);
    if (!filterRes.pass) {
      this.deps.log.info("candidate_filtered", { mint: candidate.mint, reasons: filterRes.reasons });
      this.deps.discovery.remove(candidate.mint);
      return;
    }

    const vec = this.features.build(feats);
    const score = this.model.score(candidate.mint, vec);
    const decision = this.strategy.decideEntry(score, feats);
    if (decision.action !== "ENTER") {
      this.deps.log.info("candidate_skipped", { mint: candidate.mint, reason: decision.reason, score });
      this.deps.discovery.remove(candidate.mint);
      return;
    }

    const signerOk = await this.signer.health().catch(() => false);
    if (!signerOk) throw new Error("signer_unhealthy");

    const user = await this.signer.getPublicKey();
    const balanceLamports = await this.deps.rpc.withConnection((c) => c.getBalance(user, "confirmed"));
    const balanceSol = balanceLamports / 1e9;
    const sizeSol = this.deps.risk.allocatePositionSize(balanceSol, this.deps.cfg.strategy.positionSizePercent);
    if (sizeSol <= 0) return;

    const sizeLamports = BigInt(Math.floor(sizeSol * 1e9));
    const signature = await this.deps.rpc.withConnection(async (conn) => {
      const res = await this.executor.swapSolToToken({
        conn,
        outputMint: new PublicKey(candidate.mint),
        solLamports: sizeLamports,
        userPublicKey: user
      });
      return res.signature;
    });

    this.deps.risk.openPosition(candidate.mint, sizeSol, signature);
    this.deps.discovery.remove(candidate.mint);
    this.deps.log.info("position_opened", { mint: candidate.mint, sizeSol, signature, score });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
