import type { TradingConfig, SignalScore, TokenFeatures } from "../../../shared/types";
import type { FeatureVector } from "../features/feature-engine";
import type { Logger } from "../utils/logger";
import type { DegenAiController, DegenDecision, FeatureSnapshotV1, ControllerFlag } from "../ai/degen-policy";

export type EntryDecision =
  | { action: "ENTER"; reason: string; profile: string; controller: ControllerFlag; snapshot: FeatureSnapshotV1; ai?: DegenDecision }
  | { action: "SKIP"; reason: string; controller: ControllerFlag; snapshot: FeatureSnapshotV1; ai?: DegenDecision };

export class StrategyEngine {
  constructor(
    private readonly deps: {
      strategyCfg: TradingConfig["strategy"];
      aiCfg: TradingConfig["ai"];
      ai: DegenAiController;
      log: Logger;
    }
  ) {}

  decideEntry(opts: {
    score: SignalScore;
    tokenFeatures: TokenFeatures;
    featureVector: FeatureVector;
    defaultProfile: string;
    allowedProfiles: string[];
  }): EntryDecision {
    const { score, tokenFeatures: features } = opts;
    const snap = this.deps.ai.buildSnapshot(opts.featureVector, score);

    if (score.confidence < this.deps.strategyCfg.entryMinConfidence) return { action: "SKIP", reason: "low_confidence", controller: "system", snapshot: snap };
    if (score.pumpProbability < this.deps.strategyCfg.entryMinPumpProb)
      return { action: "SKIP", reason: "low_pump_probability", controller: "system", snapshot: snap };
    if (score.rugProbability > this.deps.strategyCfg.entryMaxRugProb)
      return { action: "SKIP", reason: "high_rug_probability", controller: "system", snapshot: snap };

    if (features.hasFrozenAuthority) return { action: "SKIP", reason: "freeze_authority_present", controller: "system", snapshot: snap };
    if (features.topHolderPct > 50) return { action: "SKIP", reason: "extreme_top_holder_pct", controller: "system", snapshot: snap };

    // Deterministic hard disqualifiers above; AI can only choose among allowed actions after passing them.
    const canAi = this.deps.ai.canControlNow(Date.now());
    if (!canAi.ok) {
      return { action: "ENTER", reason: "signal_thresholds_met", profile: opts.defaultProfile, controller: "system", snapshot: snap };
    }

    // AI-specific hard safety threshold (only when AI is actually controlling).
    if (score.rugProbability > this.deps.aiCfg.maxRugScore) {
      return { action: "SKIP", reason: "ai_max_rug_score", controller: "system", snapshot: snap };
    }

    const decision = this.deps.ai.decide(opts.featureVector, score, { allowedProfiles: opts.allowedProfiles });
    if (decision.action === "skip") {
      this.deps.log.info("ai_entry_decision", {
        action: "skip",
        q: decision.score,
        exploratory: decision.exploratory,
        top: this.deps.ai.explain(snap, "skip")
      });
      return { action: "SKIP", reason: "ai_skip", controller: "ai", snapshot: snap, ai: decision };
    }

    const profile = String(decision.action).slice("profile:".length);
    if (!opts.allowedProfiles.includes(profile)) {
      return { action: "ENTER", reason: "ai_invalid_profile_fallback", profile: opts.defaultProfile, controller: "system", snapshot: snap };
    }

    this.deps.log.info("ai_entry_decision", {
      action: decision.action,
      q: decision.score,
      exploratory: decision.exploratory,
      top: this.deps.ai.explain(snap, decision.action)
    });

    return { action: "ENTER", reason: "ai_profile_selected", profile, controller: "ai", snapshot: snap, ai: decision };
  }
}
