import dotenv from "dotenv";
import { readEnv } from "./env";
import { Logger } from "./utils/logger";
import { loadTradingConfig } from "./config";
import { RpcManager } from "./rpc/rpc-manager";
import { DiscoveryService } from "./chain/discovery";
import { ChainIntelligence } from "./chain/intelligence";
import { RiskManager } from "./risk/risk-manager";
import { Orchestrator } from "./orchestrator";
import { createApiServer } from "./api-server";
import { openDb } from "./db/db";
import { CandidateRepo } from "./db/repositories/candidates";
import { PositionRepo } from "./db/repositories/positions";
import { RiskLedgerRepo } from "./db/repositories/risk-ledger";
import { SettingsRepo } from "./db/repositories/settings";
import { TxAttemptsRepo } from "./db/repositories/tx-attempts";
import { LogDiscoveryEngine } from "./discovery/log-discovery";
import { ControlsRepo } from "./controls/controls";
import { GovernanceRepo } from "./db/repositories/governance";
import { ActionDedupeRepo } from "./db/repositories/action-dedupe";
import { PaperBalancesRepo, PaperLedgerRepo } from "./db/repositories/paper-ledger";
import { AiEntriesRepo, AiOutcomesRepo } from "./db/repositories/ai";
import { DegenAiController } from "./ai/degen-policy";

dotenv.config();

async function main() {
  const env = readEnv(process.env);
  try {
    if (env.PROCESS_PRIORITY !== 0) process.setPriority(env.PROCESS_PRIORITY);
  } catch {
    // ignore priority errors
  }

  const log = new Logger({
    level: env.LOG_LEVEL,
    filePath: env.LOG_FILE,
    maxSizeMb: env.LOG_MAX_SIZE_MB,
    maxFiles: env.LOG_MAX_FILES,
    console: env.LOG_CONSOLE ?? true
  });

  const cfg = loadTradingConfig({ dir: process.cwd() });
  const rpc = new RpcManager({ rpc: cfg.rpc, overrideHttp: env.SOLANA_RPC_HTTP, overrideWs: env.SOLANA_RPC_WS });

  const db = openDb(
    {
      filePath: cfg.storage?.sqlite?.path ?? "./data/trading.db",
      wal: cfg.storage?.sqlite?.wal ?? true,
      busyTimeoutMs: cfg.storage?.sqlite?.busyTimeoutMs ?? 5000
    },
    log
  );
  const candidates = new CandidateRepo(db);
  const positions = new PositionRepo(db);
  const ledger = new RiskLedgerRepo(db);
  const settings = new SettingsRepo(db);
  const controlsRepo = new ControlsRepo(settings);
  const txAttempts = new TxAttemptsRepo(db);
  const governance = new GovernanceRepo(db);
  const actionDedupe = new ActionDedupeRepo(db);
  const paperLedger = new PaperLedgerRepo(db);
  const paperBalances = new PaperBalancesRepo(db);
  const aiEntries = new AiEntriesRepo(db);
  const aiOutcomes = new AiOutcomesRepo(db);
  const ai = new DegenAiController({ aiCfg: cfg.ai, entries: aiEntries, outcomes: aiOutcomes, settings, log });

  const discovery = new DiscoveryService(candidates);
  const intelligence = new ChainIntelligence(rpc);
  const risk = new RiskManager(cfg.risk, { positions, ledger });

  const discoveryCfg = cfg.discovery;
  const logDiscovery =
    discoveryCfg && discoveryCfg.enabled
      ? new LogDiscoveryEngine({ cfg: discoveryCfg, rpc, discovery, settings, log })
      : null;

  const orchestrator = new Orchestrator({
    env,
    cfg,
    log,
    rpc,
    discovery,
    intelligence,
    risk,
    positions,
    controls: controlsRepo,
    txAttempts,
    governance,
    actionDedupe,
    paperLedger,
    paperBalances,
    ai
  });
  const server = createApiServer({ env, cfg, orchestrator, discovery, risk, log, controls: controlsRepo, governance, paperLedger });

  if (cfg.ai.enabled && cfg.ai.bootstrapOnStartup) {
    const allowedProfiles = Object.entries(cfg.profiles)
      .filter(([, p]) => !!p?.enabled)
      .map(([name]) => name);
    ai.bootstrap(Date.now(), allowedProfiles);
  }

  server.listen(env.PORT, env.HOST, () => {
    log.info("trading_node_started", { host: env.HOST, port: env.PORT });
  });

  await logDiscovery?.start().catch((e) => log.error("discovery_start_failed", { error: String(e) }));

  process.on("SIGINT", async () => {
    log.info("shutdown_sigint");
    await logDiscovery?.stop().catch(() => undefined);
    await orchestrator.stop().catch(() => undefined);
    server.close(() => process.exit(0));
  });
  process.on("SIGTERM", async () => {
    log.info("shutdown_sigterm");
    await logDiscovery?.stop().catch(() => undefined);
    await orchestrator.stop().catch(() => undefined);
    server.close(() => process.exit(0));
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
