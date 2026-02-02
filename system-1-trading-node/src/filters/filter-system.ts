import type { TradingConfig, TokenFeatures } from "../../../shared/types";

export class FilterSystem {
  constructor(private readonly cfg: TradingConfig["filters"]) {}

  evaluate(f: TokenFeatures): { pass: boolean; reasons: string[] } {
    const reasons: string[] = [];

    if (f.ageHours > this.cfg.maxAgeHours) reasons.push("too_old");
    if (f.liquiditySol < this.cfg.minLiquiditySol) reasons.push("low_liquidity");
    if (f.liquiditySol > this.cfg.maxLiquiditySol) reasons.push("liquidity_too_high");
    if (f.volume24hSol < this.cfg.minVolume24hSol) reasons.push("low_volume");
    if (f.topHolderPct > this.cfg.maxTopHolderPct) reasons.push("top_holder_too_high");
    if (f.holderCount < this.cfg.minHolderCount) reasons.push("too_few_holders");

    // Security-focused interpretation:
    // - requireFrozenAuthority == true => freeze authority must be absent
    if (this.cfg.requireFrozenAuthority && f.hasFrozenAuthority) reasons.push("freeze_authority_present");
    if (this.cfg.requireRevokedMintAuthority && !f.hasRevokedMintAuthority)
      reasons.push("mint_authority_not_revoked");

    return { pass: reasons.length === 0, reasons };
  }
}

