import { Connection } from "@solana/web3.js";
import type { TradingConfig } from "../../../shared/types";

export class RpcManager {
  private readonly config: TradingConfig["rpc"];
  private readonly overrideHttp?: string;
  private readonly overrideWs?: string;
  private currentIndex = 0;
  private lastHealthyAt = 0;

  constructor(opts: { rpc: TradingConfig["rpc"]; overrideHttp?: string; overrideWs?: string }) {
    this.config = opts.rpc;
    this.overrideHttp = opts.overrideHttp;
    this.overrideWs = opts.overrideWs;
  }

  getHttpUrl(): string {
    if (this.overrideHttp) return this.overrideHttp;
    const endpoints = [...this.config.endpoints].sort((a, b) => a.priority - b.priority);
    return endpoints[Math.min(this.currentIndex, endpoints.length - 1)].url;
  }

  getWsUrl(): string {
    if (this.overrideWs) return this.overrideWs;
    const endpoints = [...this.config.wsEndpoints].sort((a, b) => a.priority - b.priority);
    return endpoints[Math.min(this.currentIndex, endpoints.length - 1)].url;
  }

  getConnection(): Connection {
    return new Connection(this.getHttpUrl(), { commitment: "confirmed", wsEndpoint: this.getWsUrl() });
  }

  async healthCheck(signal?: AbortSignal): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastHealthyAt < Math.max(1000, this.config.healthCheckIntervalMs / 2)) return true;
    try {
      const conn = this.getConnection();
      await withTimeout(conn.getLatestBlockhash("confirmed"), this.config.timeoutMs, signal);
      this.lastHealthyAt = now;
      return true;
    } catch {
      this.rotateEndpoint();
      return false;
    }
  }

  rotateEndpoint(): void {
    const endpoints = this.config.endpoints.length;
    if (endpoints <= 1) return;
    this.currentIndex = (this.currentIndex + 1) % endpoints;
  }

  async withConnection<T>(fn: (conn: Connection) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const max = Math.max(1, this.config.maxRetries + 1);
    let lastErr: unknown;
    for (let attempt = 0; attempt < max; attempt++) {
      try {
        await this.healthCheck(signal);
        const conn = this.getConnection();
        return await withTimeout(fn(conn), this.config.timeoutMs, signal);
      } catch (e) {
        lastErr = e;
        this.rotateEndpoint();
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("RPC call failed");
  }
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

