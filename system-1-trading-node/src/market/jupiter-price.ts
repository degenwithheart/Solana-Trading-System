import { PublicKey } from "@solana/web3.js";

export class JupiterPriceService {
  constructor(private readonly priceUrl: string, private readonly timeoutMs: number) {}

  async getUsdPrices(mints: PublicKey[]): Promise<Map<string, number>> {
    if (mints.length === 0) return new Map();
    const url = new URL(this.priceUrl);
    url.searchParams.set("ids", mints.map((m) => m.toBase58()).join(","));
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`Jupiter price failed: ${res.status}`);
    const json = (await res.json()) as any;
    const out = new Map<string, number>();
    const data = json?.data ?? {};
    for (const mint of mints) {
      const p = data?.[mint.toBase58()]?.price;
      if (typeof p === "number" && Number.isFinite(p)) out.set(mint.toBase58(), p);
    }
    return out;
  }
}

