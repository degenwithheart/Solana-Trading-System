import crypto from "node:crypto";
import type { TradingConfig, Position } from "../../../shared/types";
import { JsonFileStorage } from "../utils/storage";

export type RiskState = {
  date: string;
  realizedPnlSol: number;
  circuitBreakerTrips: number;
};

export class RiskManager {
  private readonly cfg: TradingConfig["risk"];
  private readonly storage: JsonFileStorage<{ risk: RiskState; positions: Position[] }>;

  constructor(cfg: TradingConfig["risk"], storage: JsonFileStorage<{ risk: RiskState; positions: Position[] }>) {
    this.cfg = cfg;
    this.storage = storage;
  }

  canOpenPosition(currentOpen: number): { ok: boolean; reason?: string } {
    if (currentOpen >= this.cfg.maxConcurrentPositions) return { ok: false, reason: "max_positions" };

    const state = this.readState();
    if (state.risk.realizedPnlSol <= -Math.abs(this.cfg.maxDailyLossSol)) return { ok: false, reason: "daily_loss" };

    if (this.cfg.enableCircuitBreaker && state.risk.circuitBreakerTrips >= this.cfg.circuitBreakerThreshold) {
      return { ok: false, reason: "circuit_breaker" };
    }
    return { ok: true };
  }

  allocatePositionSize(balanceSol: number, strategyPercent: number): number {
    const raw = (balanceSol * Math.max(0, strategyPercent)) / 100;
    const capped = Math.min(raw, this.cfg.maxPositionSizeSol);
    return Math.max(0, capped);
  }

  openPosition(mint: string, sizeSol: number, entrySignature?: string): Position {
    const state = this.readState();
    const id = crypto.randomUUID();
    const pos: Position = {
      id,
      mint,
      openedAt: new Date().toISOString(),
      sizeSol,
      entrySignature,
      status: "OPEN"
    };
    state.positions.unshift(pos);
    this.storage.write(state);
    return pos;
  }

  closePosition(id: string, patch: Partial<Pick<Position, "exitSignature" | "pnlSol" | "status" | "notes">>): Position {
    const state = this.readState();
    const idx = state.positions.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error("Position not found");
    const current = state.positions[idx];
    const updated: Position = { ...current, ...patch, status: patch.status ?? "CLOSED" };
    state.positions[idx] = updated;

    if (typeof patch.pnlSol === "number" && Number.isFinite(patch.pnlSol)) {
      state.risk.realizedPnlSol += patch.pnlSol;
    }
    this.storage.write(state);
    return updated;
  }

  listPositions(): Position[] {
    return this.readState().positions;
  }

  tripCircuitBreaker(): void {
    const state = this.readState();
    state.risk.circuitBreakerTrips += 1;
    this.storage.write(state);
  }

  private readState(): { risk: RiskState; positions: Position[] } {
    const today = new Date().toISOString().slice(0, 10);
    const state = this.storage.read({
      risk: { date: today, realizedPnlSol: 0, circuitBreakerTrips: 0 },
      positions: []
    });
    if (state.risk.date !== today) {
      state.risk = { date: today, realizedPnlSol: 0, circuitBreakerTrips: 0 };
      this.storage.write(state);
    }
    return state;
  }
}

