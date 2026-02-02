import type { FeatureVector } from "../features/feature-engine";
import type { SignalScore } from "../../../shared/types";

function sigmoid(x: number): number {
  // Avoid overflow.
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

export class ModelClient {
  // Deterministic scoring model (no mock/randomness).
  // The weights reflect generic risk factors: centralization, authority controls, age.
  score(mint: string, v: FeatureVector): SignalScore {
    const pumpLogit =
      0.9 * log1p(v.volume24hSol) +
      0.6 * log1p(v.liquiditySol) +
      0.2 * log1p(v.holderCount) -
      0.05 * v.topHolderPct -
      0.03 * v.ageHours -
      0.6 * v.hasFrozenAuthority;

    const rugLogit =
      0.25 * v.topHolderPct +
      0.4 * v.hasFrozenAuthority +
      0.15 * (1 - v.hasRevokedMintAuthority) -
      0.2 * log1p(v.holderCount) -
      0.1 * log1p(v.liquiditySol);

    const pumpProbability = sigmoid(pumpLogit);
    const rugProbability = sigmoid(rugLogit);
    const confidence = clamp01(pumpProbability * (1 - rugProbability));

    const reasons: string[] = [];
    if (v.hasFrozenAuthority) reasons.push("freeze_authority_present");
    if (!v.hasRevokedMintAuthority) reasons.push("mint_authority_present");
    if (v.topHolderPct > 30) reasons.push("high_top_holder_pct");
    if (v.ageHours < 1) reasons.push("very_new_token");
    if (v.holderCount < 25) reasons.push("low_holder_count");

    return { mint, confidence, pumpProbability, rugProbability, reasons };
  }
}

function log1p(x: number): number {
  return Math.log(1 + Math.max(0, x));
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

