import { PublicKey, type Logs } from "@solana/web3.js";
import type { RpcManager } from "../rpc/rpc-manager";
import type { DiscoveryService } from "../chain/discovery";
import type { Logger } from "../utils/logger";
import type { SettingsRepo } from "../db/repositories/settings";
import type { TradingConfig } from "../../../shared/types";

type SourceCfg = NonNullable<TradingConfig["discovery"]>["sources"][number];

export class LogDiscoveryEngine {
  private readonly dedupe = new Map<string, number>();
  private readonly subs: Array<{ source: SourceCfg; subId: number; program: PublicKey }> = [];
  private stopped = false;

  constructor(
    private readonly deps: {
      cfg: NonNullable<TradingConfig["discovery"]>;
      rpc: RpcManager;
      discovery: DiscoveryService;
      settings: SettingsRepo;
      log: Logger;
    }
  ) {}

  async start(): Promise<void> {
    if (!this.deps.cfg.enabled) return;
    if (this.deps.cfg.sources.length === 0) {
      this.deps.log.warn("discovery_no_sources_configured");
      return;
    }

    this.stopped = false;
    await this.backfillAll().catch((e) => {
      this.deps.log.error("discovery_backfill_failed", { error: asErr(e) });
    });
    await this.subscribeAll();

    // Periodic cleanup for dedupe map to avoid unbounded growth.
    setInterval(() => this.pruneDedupe(), Math.max(1_000, this.deps.cfg.dedupeTtlMs)).unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const s of this.subs) {
      try {
        const conn = this.deps.rpc.getConnection();
        await conn.removeOnLogsListener(s.subId);
      } catch {
        // ignore
      }
    }
    this.subs.length = 0;
  }

  private async subscribeAll(): Promise<void> {
    for (const source of this.deps.cfg.sources) {
      if (!source.enabled) continue;
      const program = new PublicKey(source.programId);
      const conn = this.deps.rpc.getConnection();

      const subId = conn.onLogs(program, (l) => this.onLogs(source, program, l), source.commitment);
      this.subs.push({ source, subId, program });
      this.deps.log.info("discovery_subscribed", { name: source.name, programId: source.programId, subId });
    }
  }

  private onLogs(source: SourceCfg, _program: PublicKey, entry: Logs): void {
    if (this.stopped) return;
    if (this.isPaused()) return;
    if (entry.err) return;

    const slot = entry.context?.slot ?? null;
    const sig = entry.signature ?? "";
    if (sig) this.deps.settings.set(this.sigKey(source), sig);

    const joined = (entry.logs ?? []).join("\n");
    const mints = extractPubkeys(joined, source.maxMintsPerLog);
    for (const mint of mints) {
      if (this.isDedupeHit(mint)) continue;
      this.deps.discovery.upsertDiscovered({ mint, source: source.name, slot });
    }
  }

  private async backfillAll(): Promise<void> {
    if (!this.deps.cfg.backfill.enabled) return;
    const sources = this.deps.cfg.sources.filter((s) => s.enabled);
    const concurrency = Math.max(1, this.deps.cfg.backfill.concurrency);

    const queue = [...sources];
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const src = queue.shift();
        if (!src) return;
        await this.backfillSource(src).catch((e) => {
          this.deps.log.error("discovery_backfill_source_failed", { name: src.name, error: asErr(e) });
        });
      }
    });

    await Promise.all(workers);
  }

  private async backfillSource(source: SourceCfg): Promise<void> {
    if (this.isPaused()) return;
    const lastSig = this.deps.settings.get(this.sigKey(source));
    const program = new PublicKey(source.programId);
    const limit = Math.max(1, this.deps.cfg.backfill.limitPerSource);

    const sigs = await this.deps.rpc.withConnection((conn) =>
      conn.getSignaturesForAddress(program, { limit, until: lastSig ?? undefined }, source.commitment)
    );
    if (sigs.length === 0) return;

    // Process oldest -> newest so the checkpoint ends up at the newest signature.
    const ordered = [...sigs].reverse();
    for (const s of ordered) {
      if (this.isPaused()) return;
      if (!s.signature) continue;
      const tx = await this.deps.rpc.withConnection((conn) =>
        conn.getTransaction(s.signature, { commitment: source.commitment, maxSupportedTransactionVersion: 0 })
      );
      const logs = tx?.meta?.logMessages ?? [];
      const joined = logs.join("\n");
      const mints = extractPubkeys(joined, source.maxMintsPerLog);
      for (const mint of mints) {
        if (this.isDedupeHit(mint)) continue;
        this.deps.discovery.upsertDiscovered({
          mint,
          source: source.name,
          slot: typeof tx?.slot === "number" ? tx.slot : null
        });
      }
      this.deps.settings.set(this.sigKey(source), s.signature);
    }

    this.deps.log.info("discovery_backfill_done", { name: source.name, count: sigs.length });
  }

  private sigKey(source: SourceCfg): string {
    return `discovery.lastSig.${source.name}`;
  }

  private isDedupeHit(mint: string): boolean {
    const now = Date.now();
    const ttl = Math.max(1_000, this.deps.cfg.dedupeTtlMs);
    const prev = this.dedupe.get(mint);
    if (prev !== undefined && now - prev < ttl) return true;
    this.dedupe.set(mint, now);
    return false;
  }

  private pruneDedupe(): void {
    const now = Date.now();
    const ttl = Math.max(1_000, this.deps.cfg.dedupeTtlMs);
    for (const [k, t] of this.dedupe.entries()) {
      if (now - t > ttl) this.dedupe.delete(k);
    }
  }

  private isPaused(): boolean {
    const raw = this.deps.settings.get("controls.pauseDiscovery");
    return raw?.toLowerCase() === "true";
  }
}

function extractPubkeys(text: string, max: number): string[] {
  const out: string[] = [];
  const re = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (out.length >= max) break;
    const candidate = m[0];
    try {
      out.push(new PublicKey(candidate).toBase58());
    } catch {
      // ignore
    }
  }
  return [...new Set(out)];
}

function asErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
