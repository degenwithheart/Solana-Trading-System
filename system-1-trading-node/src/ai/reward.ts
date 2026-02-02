import type { TradingConfig } from "../../../shared/types";

export type RealizedTradeStats = {
  realizedPnlSol: number;
  holdMinutes: number;
  maxDrawdownPct: number;
};

export function computeReward(stats: RealizedTradeStats, cfg: TradingConfig["ai"]): number {
  const pnl = Number.isFinite(stats.realizedPnlSol) ? stats.realizedPnlSol : 0;
  const holdMin = Number.isFinite(stats.holdMinutes) ? Math.max(0, stats.holdMinutes) : 0;
  const dd = Number.isFinite(stats.maxDrawdownPct) ? Math.max(0, stats.maxDrawdownPct) : 0;

  return pnl - cfg.reward.holdPenalty * holdMin - cfg.reward.drawdownPenalty * dd;
}

