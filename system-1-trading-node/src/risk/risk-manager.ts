import type { TradingConfig, Position } from "../../../shared/types";
import { PositionRepo } from "../db/repositories/positions";
import { RiskLedgerRepo } from "../db/repositories/risk-ledger";

export class RiskManager {
  private readonly cfg: TradingConfig["risk"];
  private readonly positions: PositionRepo;
  private readonly ledger: RiskLedgerRepo;

  constructor(cfg: TradingConfig["risk"], deps: { positions: PositionRepo; ledger: RiskLedgerRepo }) {
    this.cfg = cfg;
    this.positions = deps.positions;
    this.ledger = deps.ledger;
  }

  canOpenPosition(currentOpen: number): { ok: boolean; reason?: string } {
    if (currentOpen >= this.cfg.maxConcurrentPositions) return { ok: false, reason: "max_positions" };

    const today = isoDate();
    const state = this.ledger.read(today);
    if (state.realizedPnlSol <= -Math.abs(this.cfg.maxDailyLossSol)) return { ok: false, reason: "daily_loss" };

    if (this.cfg.enableCircuitBreaker && state.circuitBreakerTrips >= this.cfg.circuitBreakerThreshold) {
      return { ok: false, reason: "circuit_breaker" };
    }
    return { ok: true };
  }

  allocatePositionSize(balanceSol: number, strategyPercent: number): number {
    const raw = (balanceSol * Math.max(0, strategyPercent)) / 100;
    const capped = Math.min(raw, this.cfg.maxPositionSizeSol);
    return Math.max(0, capped);
  }

  openPosition(opts: {
    mint: string;
    sizeSol: number;
    entrySignature?: string;
    entryCostSol?: number;
    entryTokenAmountRaw?: string;
    tokenDecimals?: number;
    entryPriceSol?: number;
    strategyJson: string;
    stateJson: string;
  }): Position {
    return this.positions.open(opts);
  }

  closePosition(id: string, patch: Partial<Pick<Position, "exitSignature" | "pnlSol" | "status" | "notes">>): Position {
    const updated = this.positions.close(id, patch);
    if (typeof patch.pnlSol === "number" && Number.isFinite(patch.pnlSol)) {
      this.ledger.addRealizedPnl(isoDate(), patch.pnlSol);
    }
    return updated;
  }

  listPositions(): Position[] {
    return this.positions.list();
  }

  tripCircuitBreaker(): void {
    this.ledger.tripCircuitBreaker(isoDate());
  }

  recordRealizedPnl(deltaSol: number): void {
    if (!Number.isFinite(deltaSol) || deltaSol === 0) return;
    this.ledger.addRealizedPnl(isoDate(), deltaSol);
  }
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
