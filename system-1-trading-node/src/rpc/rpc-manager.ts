import { Connection } from "@solana/web3.js";
import type { TradingConfig } from "../../../shared/types";

export class RpcManager {
  private readonly config: TradingConfig["rpc"];
  private readonly overrideHttp?: string;
  private readonly overrideWs?: string;
  private readonly stats: Map<string, { failures: number; lastOkAt: number; lastLatencyMs: number }> = new Map();
  private lastHealthCheckAt = 0;

  constructor(opts: { rpc: TradingConfig["rpc"]; overrideHttp?: string; overrideWs?: string }) {
    this.config = opts.rpc;
    this.overrideHttp = opts.overrideHttp;
    this.overrideWs = opts.overrideWs;
  }

  getHttpUrl(): string {
    if (this.overrideHttp) return this.overrideHttp;
    return this.pickHttp().url;
  }

  getWsUrl(): string {
    if (this.overrideWs) return this.overrideWs;
    const http = this.pickHttp();
    const ws = [...this.config.wsEndpoints].sort((a, b) => a.priority - b.priority);
    const match = ws.find((w) => w.provider === http.provider);
    return (match ?? ws[0]).url;
  }

  getConnection(): Connection {
    return new Connection(this.getHttpUrl(), { commitment: "confirmed", wsEndpoint: this.getWsUrl() });
  }

  async healthCheck(signal?: AbortSignal): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastHealthCheckAt < Math.max(1000, this.config.healthCheckIntervalMs)) return true;
    this.lastHealthCheckAt = now;

    const endpoints = this.sortedHttp();
    for (const ep of endpoints) {
      const start = Date.now();
      try {
        const conn = new Connection(ep.url, { commitment: "confirmed", wsEndpoint: this.getWsFor(ep.provider) });
        await withTimeout(conn.getLatestBlockhash("confirmed"), this.config.timeoutMs, signal);
        this.markOk(ep.url, Date.now() - start);
        return true;
      } catch {
        this.markFail(ep.url);
      }
    }
    return false;
  }

  async withConnection<T>(fn: (conn: Connection) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const max = Math.max(1, this.config.maxRetries + 1);
    let lastErr: unknown;
    for (let attempt = 0; attempt < max; attempt++) {
      let ep: TradingConfig["rpc"]["endpoints"][number] | null = null;
      try {
        await this.healthCheck(signal);
        ep = this.pickHttp();
        const conn = new Connection(ep.url, { commitment: "confirmed", wsEndpoint: this.getWsFor(ep.provider) });
        return await withTimeout(fn(conn), this.config.timeoutMs, signal);
      } catch (e) {
        lastErr = e;
        // Penalize current endpoint so the next attempt prefers another.
        if (ep) this.markFail(ep.url);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("RPC call failed");
  }

  private pickHttp(): TradingConfig["rpc"]["endpoints"][number] {
    const endpoints = this.sortedHttp();
    if (endpoints.length === 0) throw new Error("No RPC endpoints configured");
    endpoints.sort((a, b) => this.score(a.url, a.priority) - this.score(b.url, b.priority));
    return endpoints[0];
  }

  private sortedHttp(): TradingConfig["rpc"]["endpoints"] {
    return [...this.config.endpoints].sort((a, b) => a.priority - b.priority);
  }

  private getWsFor(provider: string): string | undefined {
    if (this.overrideWs) return this.overrideWs;
    const ws = [...this.config.wsEndpoints].sort((a, b) => a.priority - b.priority);
    return ws.find((w) => w.provider === provider)?.url ?? ws[0]?.url;
  }

  private score(url: string, priority: number): number {
    const s = this.stats.get(url);
    const failures = s?.failures ?? 0;
    const latency = s?.lastLatencyMs ?? 500;
    return priority * 1000 + failures * 10_000 + latency;
  }

  private markOk(url: string, latencyMs: number): void {
    const now = Date.now();
    const s = this.stats.get(url) ?? { failures: 0, lastOkAt: 0, lastLatencyMs: 500 };
    s.failures = Math.max(0, s.failures - 1);
    s.lastOkAt = now;
    s.lastLatencyMs = clampInt(latencyMs, 1, 30_000);
    this.stats.set(url, s);
  }

  private markFail(url: string): void {
    const s = this.stats.get(url) ?? { failures: 0, lastOkAt: 0, lastLatencyMs: 500 };
    s.failures = Math.min(1000, s.failures + 1);
    this.stats.set(url, s);
  }
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return max;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  const signals: AbortSignal[] = [controller.signal];
  if (signal) signals.push(signal);
  const combined = AbortSignal.any(signals);
  try {
    // If caller passes an already-aborted signal, race will throw.
    if (combined.aborted) throw new Error("Aborted");
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        combined.addEventListener(
          "abort",
          () => reject(new Error("Request timed out or aborted")),
          { once: true }
        );
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
