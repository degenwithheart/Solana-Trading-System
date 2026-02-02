import dotenv from "dotenv";
import { readEnv } from "./env";
import { Logger } from "./utils/logger";
import { JsonFileStorage } from "./utils/storage";
import { loadTradingConfig } from "./config";
import { RpcManager } from "./rpc/rpc-manager";
import { DiscoveryService } from "./chain/discovery";
import { ChainIntelligence } from "./chain/intelligence";
import { RiskManager } from "./risk/risk-manager";
import { Orchestrator } from "./orchestrator";
import { createApiServer } from "./api-server";

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

  const storageDir = env.STORAGE_PATH;
  const maxSizeMb = env.STORAGE_MAX_SIZE_MB;

  const candidateStore = new JsonFileStorage<{ candidates: any[] }>({
    dir: storageDir,
    filename: "candidates.json",
    maxSizeMb
  });
  const stateStore = new JsonFileStorage<{ risk: any; positions: any[] }>({
    dir: storageDir,
    filename: "state.json",
    maxSizeMb
  });

  const discovery = new DiscoveryService(candidateStore);
  const intelligence = new ChainIntelligence(rpc);
  const risk = new RiskManager(cfg.risk, stateStore);

  const orchestrator = new Orchestrator({ env, cfg, log, rpc, discovery, intelligence, risk });
  const server = createApiServer({ env, orchestrator, discovery, risk, log });

  server.listen(env.PORT, env.HOST, () => {
    log.info("trading_node_started", { host: env.HOST, port: env.PORT });
  });

  process.on("SIGINT", async () => {
    log.info("shutdown_sigint");
    await orchestrator.stop().catch(() => undefined);
    server.close(() => process.exit(0));
  });
  process.on("SIGTERM", async () => {
    log.info("shutdown_sigterm");
    await orchestrator.stop().catch(() => undefined);
    server.close(() => process.exit(0));
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

