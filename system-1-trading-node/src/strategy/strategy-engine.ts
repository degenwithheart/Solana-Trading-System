import type { TradingConfig, SignalScore, TokenFeatures } from "../../../shared/types";

export type EntryDecision =
  | { action: "ENTER"; reason: string }
  | { action: "SKIP"; reason: string };

export class StrategyEngine {
  constructor(private readonly cfg: TradingConfig["strategy"]) {}

  decideEntry(score: SignalScore, features: TokenFeatures): EntryDecision {
    if (score.confidence < this.cfg.entryMinConfidence) return { action: "SKIP", reason: "low_confidence" };
    if (score.pumpProbability < this.cfg.entryMinPumpProb) return { action: "SKIP", reason: "low_pump_probability" };
    if (score.rugProbability > this.cfg.entryMaxRugProb) return { action: "SKIP", reason: "high_rug_probability" };

    if (features.hasFrozenAuthority) return { action: "SKIP", reason: "freeze_authority_present" };
    if (features.topHolderPct > 50) return { action: "SKIP", reason: "extreme_top_holder_pct" };

    return { action: "ENTER", reason: "signal_thresholds_met" };
  }
}

