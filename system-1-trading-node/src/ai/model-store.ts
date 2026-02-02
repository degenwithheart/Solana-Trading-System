import type { SettingsRepo } from "../db/repositories/settings";
import type { Logger } from "../utils/logger";

export type ModelAction = "skip" | `profile:${string}`;

export type DegenModelV1 = {
  version: 1;
  featureKeys: string[];
  // weights[action] is length featureKeys.length
  weights: Record<string, number[]>;
  bias: Record<string, number>;
  actionCounts: Record<string, number>;
  trainedSamples: number;
  updatedAtMs: number;
};

const KEY_MODEL = "ai.model.v1";

export class ModelStore {
  constructor(
    private readonly deps: {
      settings: SettingsRepo;
      log: Logger;
    }
  ) {}

  loadOrInit(featureKeys: string[]): DegenModelV1 {
    const raw = this.deps.settings.get(KEY_MODEL);
    if (!raw) return initModel(featureKeys);
    try {
      const parsed = JSON.parse(raw) as any;
      if (parsed?.version !== 1) return initModel(featureKeys);
      const fk = Array.isArray(parsed.featureKeys) ? parsed.featureKeys.map(String) : [];
      if (!sameKeys(fk, featureKeys)) return initModel(featureKeys);
      const model: DegenModelV1 = {
        version: 1,
        featureKeys,
        weights: coerceWeights(parsed.weights, featureKeys.length),
        bias: coerceNums(parsed.bias),
        actionCounts: coerceNums(parsed.actionCounts) as any,
        trainedSamples: Number.isFinite(Number(parsed.trainedSamples)) ? Number(parsed.trainedSamples) : 0,
        updatedAtMs: Number.isFinite(Number(parsed.updatedAtMs)) ? Number(parsed.updatedAtMs) : Date.now()
      };
      return model;
    } catch {
      return initModel(featureKeys);
    }
  }

  save(model: DegenModelV1): void {
    this.deps.settings.set(KEY_MODEL, JSON.stringify(model));
  }
}

function initModel(featureKeys: string[]): DegenModelV1 {
  return {
    version: 1,
    featureKeys,
    weights: {},
    bias: {},
    actionCounts: {},
    trainedSamples: 0,
    updatedAtMs: Date.now()
  };
}

function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function coerceWeights(input: any, len: number): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) {
    if (!Array.isArray(v)) continue;
    const arr = v.map((n) => Number(n));
    if (arr.length !== len) continue;
    if (!arr.every((n) => Number.isFinite(n))) continue;
    out[String(k)] = arr;
  }
  return out;
}

function coerceNums(input: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out[String(k)] = n;
  }
  return out;
}

