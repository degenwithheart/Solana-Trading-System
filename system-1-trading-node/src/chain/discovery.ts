import { PublicKey } from "@solana/web3.js";
import type { CandidateToken } from "../../../shared/types";
import { JsonFileStorage } from "../utils/storage";

export class DiscoveryService {
  private readonly storage: JsonFileStorage<{ candidates: CandidateToken[] }>;

  constructor(storage: JsonFileStorage<{ candidates: CandidateToken[] }>) {
    this.storage = storage;
  }

  list(): CandidateToken[] {
    return this.storage.read({ candidates: [] }).candidates;
  }

  remove(mint: string): void {
    const pk = new PublicKey(mint);
    const normalized = pk.toBase58();
    const state = this.storage.read({ candidates: [] });
    const next = state.candidates.filter((c) => c.mint !== normalized);
    if (next.length === state.candidates.length) return;
    state.candidates = next;
    this.storage.write(state);
  }

  addManual(mint: string): CandidateToken {
    const pk = new PublicKey(mint); // validates base58
    const normalized = pk.toBase58();

    const state = this.storage.read({ candidates: [] });
    const exists = state.candidates.some((c) => c.mint === normalized);
    if (exists) return state.candidates.find((c) => c.mint === normalized)!;

    const token: CandidateToken = {
      mint: normalized,
      discoveredAt: new Date().toISOString(),
      source: "manual"
    };
    state.candidates.unshift(token);
    this.storage.write(state);
    return token;
  }
}
