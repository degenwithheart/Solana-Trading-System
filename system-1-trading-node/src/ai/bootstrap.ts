import type { TradingConfig } from "../../../shared/types";
import type { AiOutcomesRepo, AiSampleRow } from "../db/repositories/ai";

export function loadRecentSamples(opts: {
  outcomes: AiOutcomesRepo;
  aiCfg: TradingConfig["ai"];
  nowMs: number;
}): AiSampleRow[] {
  const windowMs = Math.max(1, opts.aiCfg.recentWindowDays) * 24 * 60 * 60 * 1000;
  const since = opts.nowMs - windowMs;
  return opts.outcomes.listSamplesClosedSince(since);
}

