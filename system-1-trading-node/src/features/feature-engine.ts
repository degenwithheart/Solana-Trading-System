import type { TokenFeatures } from "../../../shared/types";

export type FeatureVector = {
  ageHours: number;
  holderCount: number;
  topHolderPct: number;
  liquiditySol: number;
  volume24hSol: number;
  hasFrozenAuthority: number;
  hasRevokedMintAuthority: number;
};

export class FeatureEngine {
  build(f: TokenFeatures): FeatureVector {
    return {
      ageHours: clampNonNegative(f.ageHours),
      holderCount: clampNonNegative(f.holderCount),
      topHolderPct: clampNonNegative(f.topHolderPct),
      liquiditySol: clampNonNegative(f.liquiditySol),
      volume24hSol: clampNonNegative(f.volume24hSol),
      hasFrozenAuthority: f.hasFrozenAuthority ? 1 : 0,
      hasRevokedMintAuthority: f.hasRevokedMintAuthority ? 1 : 0
    };
  }
}

function clampNonNegative(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

