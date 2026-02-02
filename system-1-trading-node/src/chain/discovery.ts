import { PublicKey } from "@solana/web3.js";
import type { CandidateToken } from "../../../shared/types";
import type { CandidateRepo } from "../db/repositories/candidates";

export class DiscoveryService {
  constructor(private readonly repo: CandidateRepo) {}

  list(limit = 250): CandidateToken[] {
    return this.repo.listRecent(limit).map((r) => ({
      mint: r.mint,
      discoveredAt: r.first_seen_at,
      source: r.source as any
    }));
  }

  remove(mint: string): void {
    const pk = new PublicKey(mint);
    const normalized = pk.toBase58();
    this.repo.removeByMint(normalized);
  }

  addManual(mint: string): CandidateToken {
    const pk = new PublicKey(mint); // validates base58
    const normalized = pk.toBase58();
    const row = this.repo.upsertDiscovered({ mint: normalized, source: "manual" });
    return { mint: row.mint, discoveredAt: row.first_seen_at, source: "manual" };
  }

  upsertDiscovered(opts: { mint: string; source: string; slot?: number | null }): void {
    this.repo.upsertDiscovered({ mint: opts.mint, source: opts.source, slot: opts.slot ?? null });
  }

  markScored(opts: { mint: string; confidence: number; pump: number; rug: number; reasons: string[] }): void {
    this.repo.markScored(opts);
  }
}
