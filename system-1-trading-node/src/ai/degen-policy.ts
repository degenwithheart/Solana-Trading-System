import type { SignalScore } from "../../../shared/types";
import type { FeatureVector } from "../features/feature-engine";
import type { TradingConfig } from "../../../shared/types";
import type { Logger } from "../utils/logger";
import type { SettingsRepo } from "../db/repositories/settings";
import type { AiEntriesRepo, AiOutcomesRepo } from "../db/repositories/ai";
import { ModelStore, type DegenModelV1, type ModelAction } from "./model-store";
import { computeReward, type RealizedTradeStats } from "./reward";
import { AiStats } from "./stats";
import { loadRecentSamples } from "./bootstrap";

export interface DegenDecision {
  action: "skip" | `profile:${string}`;
  score: number;
  exploratory: boolean;
}

export type ControllerFlag = "system" | "ai";

export type FeatureSnapshotV1 = {
  version: 1;
  keys: string[];
  values: number[];
};

const FEATURE_KEYS: ReadonlyArray<string> = [
  "age_log1p",
  "holders_log1p",
  "topHolderPct_pct",
  "liquidity_log1p",
  "volume24h_log1p",
  "frozen_flag",
  "revoked_flag",
  "score_confidence",
  "score_pump",
  "score_rug"
];

export class DegenAiController {
  private readonly modelStore: ModelStore;
  private readonly stats: AiStats;
  private model: DegenModelV1;

  constructor(
    private readonly deps: {
      aiCfg: TradingConfig["ai"];
      entries: AiEntriesRepo;
      outcomes: AiOutcomesRepo;
      settings: SettingsRepo;
      log: Logger;
    }
  ) {
    this.modelStore = new ModelStore({ settings: deps.settings, log: deps.log });
    this.stats = new AiStats({ settings: deps.settings, log: deps.log });
    this.model = this.modelStore.loadOrInit([...FEATURE_KEYS]);
  }

  trainedSamples(): number {
    return this.model.trainedSamples;
  }

  rolling24hAiPnlSol(nowMs: number): number {
    return this.stats.rolling24hPnlSol(nowMs);
  }

  canControlNow(nowMs: number): { ok: boolean; reason?: string } {
    if (!this.deps.aiCfg.enabled) return { ok: false, reason: "disabled" };
    if (this.model.trainedSamples < this.deps.aiCfg.minSamplesBeforeLive) return { ok: false, reason: "min_samples" };
    const rolling = this.stats.rolling24hPnlSol(nowMs);
    if (rolling <= -Math.abs(this.deps.aiCfg.aiDailyLossLimitSol)) return { ok: false, reason: "daily_loss_limit" };
    return { ok: true };
  }

  buildSnapshot(vec: FeatureVector, score: SignalScore): FeatureSnapshotV1 {
    const x = featureValues(vec, score);
    return { version: 1, keys: [...FEATURE_KEYS], values: x };
  }

  decide(
    vec: FeatureVector,
    score: SignalScore,
    ctx: { allowedProfiles: string[] }
  ): DegenDecision {
    const actions = allowedActions(ctx.allowedProfiles);

    // Epsilon-greedy exploration.
    const explore = Math.random() < clamp01(this.deps.aiCfg.epsilon);
    if (explore) {
      const action = actions[Math.floor(Math.random() * actions.length)] as DegenDecision["action"];
      const snap = this.buildSnapshot(vec, score);
      return { action, score: this.q(snap, action), exploratory: true };
    }

    const snap = this.buildSnapshot(vec, score);
    let best: DegenDecision = { action: "skip", score: this.q(snap, "skip"), exploratory: false };
    for (const a of actions) {
      const q = this.q(snap, a as any);
      if (q > best.score) best = { action: a as any, score: q, exploratory: false };
    }
    return best;
  }

  explain(snapshot: FeatureSnapshotV1, action: DegenDecision["action"], topN = 6): Array<{ key: string; contribution: number }> {
    const w = this.ensureWeights(action);
    const pairs = snapshot.keys.map((k, i) => ({ key: k, contribution: (w[i] ?? 0) * (snapshot.values[i] ?? 0) }));
    pairs.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    return pairs.slice(0, Math.max(1, topN));
  }

  onEntry(entryId: string, snapshot: FeatureSnapshotV1, action: ModelAction, controller: ControllerFlag, openedAtMs: number): void {
    this.deps.entries.upsert({
      entryId,
      featuresJson: JSON.stringify(snapshot),
      action,
      controller,
      openedAt: openedAtMs
    });
  }

  onExit(entryId: string, stats: RealizedTradeStats & { closedAtMs: number }): void {
    const entry = this.deps.entries.get(entryId);
    if (!entry) return;
    if (this.deps.outcomes.get(entryId)) return; // idempotent

    const reward = computeReward(stats, this.deps.aiCfg);
    this.deps.outcomes.upsert({ entryId, reward, closedAt: stats.closedAtMs });

    // Track rolling AI-only PnL for circuit breaker.
    if (entry.controller === "ai") {
      this.stats.recordAiClose(entryId, stats.realizedPnlSol, stats.closedAtMs, this.deps.aiCfg.aiDailyLossLimitSol);
    }

    const snapshot = safeParseSnapshot(entry.featuresJson, this.model.featureKeys);
    if (!snapshot) return;
    this.train(snapshot, entry.action as ModelAction, reward, stats.closedAtMs);
    this.modelStore.save(this.model);
  }

  bootstrap(nowMs: number, allowedProfiles: string[]): void {
    if (!this.deps.aiCfg.enabled) return;
    if (!this.deps.aiCfg.bootstrapOnStartup) return;

    const samples = loadRecentSamples({ outcomes: this.deps.outcomes, aiCfg: this.deps.aiCfg, nowMs });
    if (samples.length === 0) return;

    this.model = this.modelStore.loadOrInit([...FEATURE_KEYS]);
    this.model.weights = {};
    this.model.bias = {};
    this.model.actionCounts = {};
    this.model.trainedSamples = 0;

    const allowed = new Set(allowedActions(allowedProfiles));
    for (const s of samples) {
      if (!allowed.has(s.action)) continue;
      const snap = safeParseSnapshot(s.featuresJson, this.model.featureKeys);
      if (!snap) continue;
      this.train(snap, s.action as ModelAction, s.reward, s.closedAt);
    }
    this.modelStore.save(this.model);
    this.deps.log.info("ai_bootstrap_complete", { samples: this.model.trainedSamples, windowDays: this.deps.aiCfg.recentWindowDays });
  }

  private q(snapshot: FeatureSnapshotV1, action: DegenDecision["action"]): number {
    const w = this.ensureWeights(action);
    const b = this.model.bias[action] ?? 0;
    let s = b;
    for (let i = 0; i < snapshot.values.length; i++) s += (w[i] ?? 0) * (snapshot.values[i] ?? 0);
    return s;
  }

  private ensureWeights(action: DegenDecision["action"]): number[] {
    const k = action as string;
    const existing = this.model.weights[k];
    if (existing && existing.length === this.model.featureKeys.length) return existing;
    const w = new Array(this.model.featureKeys.length).fill(0);
    this.model.weights[k] = w;
    if (!(k in this.model.bias)) this.model.bias[k] = 0;
    if (!(k in this.model.actionCounts)) this.model.actionCounts[k] = 0;
    return w;
  }

  private train(snapshot: FeatureSnapshotV1, action: ModelAction, reward: number, atMs: number): void {
    const dtDays = Math.max(0, (atMs - (this.model.updatedAtMs || atMs)) / (24 * 60 * 60 * 1000));
    const halfLifeDays = Math.max(1, this.deps.aiCfg.recentWindowDays);
    const decay = Math.exp((-Math.log(2) * dtDays) / halfLifeDays);

    // Global decay (recency bias) applied before the update.
    for (const k of Object.keys(this.model.weights)) {
      const w = this.model.weights[k];
      for (let i = 0; i < w.length; i++) w[i] *= decay;
      this.model.bias[k] = (this.model.bias[k] ?? 0) * decay;
    }

    const w = this.ensureWeights(action);
    const pred = this.q(snapshot, action as any);
    const err = clampFinite(reward) - pred;

    const n = (this.model.actionCounts[action] ?? 0) + 1;
    this.model.actionCounts[action] = n;
    const alpha = clamp(0.05 / Math.sqrt(n), 0.001, 0.05);

    for (let i = 0; i < w.length; i++) {
      w[i] += alpha * err * (snapshot.values[i] ?? 0);
    }
    this.model.bias[action] = (this.model.bias[action] ?? 0) + alpha * err;

    this.model.trainedSamples += 1;
    this.model.updatedAtMs = atMs;
  }
}

function allowedActions(profiles: string[]): ModelAction[] {
  const uniq = Array.from(new Set(profiles.filter((p) => p && p.length > 0))).sort();
  return ["skip", ...uniq.map((p) => `profile:${p}` as const)];
}

function featureValues(vec: FeatureVector, score: SignalScore): number[] {
  const age = Math.log1p(clampNonNeg(vec.ageHours));
  const holders = Math.log1p(clampNonNeg(vec.holderCount));
  const top = clampNonNeg(vec.topHolderPct) / 100;
  const liq = Math.log1p(clampNonNeg(vec.liquiditySol));
  const vol = Math.log1p(clampNonNeg(vec.volume24hSol));
  const frozen = clamp01(vec.hasFrozenAuthority);
  const revoked = clamp01(vec.hasRevokedMintAuthority);
  const conf = clamp01(score.confidence);
  const pump = clamp01(score.pumpProbability);
  const rug = clamp01(score.rugProbability);
  return [age, holders, top, liq, vol, frozen, revoked, conf, pump, rug];
}

function clampNonNeg(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampFinite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  const v = Number.isFinite(n) ? n : 0;
  return Math.min(hi, Math.max(lo, v));
}

function safeParseSnapshot(raw: string, expectedKeys: string[]): FeatureSnapshotV1 | null {
  try {
    const parsed = JSON.parse(raw) as any;
    if (parsed?.version !== 1) return null;
    const keys = Array.isArray(parsed.keys) ? parsed.keys.map(String) : [];
    const values = Array.isArray(parsed.values) ? parsed.values.map((n: any) => Number(n)) : [];
    if (keys.length !== expectedKeys.length || values.length !== expectedKeys.length) return null;
    for (let i = 0; i < expectedKeys.length; i++) if (keys[i] !== expectedKeys[i]) return null;
    if (!values.every((n) => Number.isFinite(n))) return null;
    return { version: 1, keys: expectedKeys, values };
  } catch {
    return null;
  }
}
