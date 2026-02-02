import express from "express";
import helmet from "helmet";
import cors from "cors";
import { z } from "zod";
import type { Orchestrator } from "./orchestrator";
import type { TradingEnv } from "./env";
import type { DiscoveryService } from "./chain/discovery";
import type { RiskManager } from "./risk/risk-manager";
import type { Logger } from "./utils/logger";
import type { HealthStatus } from "../../shared/types";
import { WebSocketServer } from "ws";
import http from "node:http";

export function createApiServer(opts: {
  env: TradingEnv;
  orchestrator: Orchestrator;
  discovery: DiscoveryService;
  risk: RiskManager;
  log: Logger;
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "256kb" }));
  app.use(cors({ origin: opts.env.CORS_ORIGIN === "*" ? true : opts.env.CORS_ORIGIN }));

  app.use((req, res, next) => {
    if (opts.env.API_KEY && req.path !== "/health") {
      const key = req.header("x-api-key") ?? "";
      if (key !== opts.env.API_KEY) return res.status(401).json({ error: "unauthorized" });
    }
    next();
  });

  const windowMs = opts.env.RATE_LIMIT_WINDOW_MS;
  const max = opts.env.RATE_LIMIT_MAX;
  const ipHits = new Map<string, { count: number; resetAt: number }>();
  app.use((req, res, next) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const entry = ipHits.get(ip) ?? { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    ipHits.set(ip, entry);
    if (entry.count > max) return res.status(429).json({ error: "rate_limited" });
    next();
  });

  app.get("/health", (_req, res) => {
    const payload: HealthStatus = {
      ok: true,
      service: "system-1-trading-node",
      version: "1.0.0",
      timestamp: new Date().toISOString()
    };
    res.json(payload);
  });

  app.get("/status", (_req, res) => {
    res.json({ status: opts.orchestrator.getStatus() });
  });

  app.get("/positions", (_req, res) => {
    res.json({ positions: opts.risk.listPositions() });
  });

  app.get("/candidates", (_req, res) => {
    res.json({ candidates: opts.discovery.list() });
  });

  app.post("/candidates", async (req, res) => {
    const schema = z.object({ mint: z.string().min(32) });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "invalid_body" });
    const candidate = opts.discovery.addManual(body.data.mint);
    res.json({ candidate });
  });

  app.post("/start", async (_req, res) => {
    await opts.orchestrator.start();
    res.json({ ok: true });
  });

  app.post("/stop", async (_req, res) => {
    await opts.orchestrator.stop();
    res.json({ ok: true });
  });

  if (opts.env.ENABLE_DEBUG_ENDPOINTS) {
    app.post("/tick", async (_req, res) => {
      await opts.orchestrator.tickOnce();
      res.json({ ok: true });
    });
  }

  const server = http.createServer(app);

  if (opts.env.ENABLE_WEBSOCKET) {
    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "status", data: opts.orchestrator.getStatus() }));
      const interval = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(JSON.stringify({ type: "status", data: opts.orchestrator.getStatus() }));
      }, Math.max(1000, opts.env.HEARTBEAT_INTERVAL_MS));
      ws.on("close", () => clearInterval(interval));
    });
  }

  server.on("error", (err) => {
    opts.log.error("api_server_error", { error: String(err) });
  });

  return server;
}

