import { PublicKey } from "@solana/web3.js";

export class MarketFeed {
  constructor(private readonly priceUrl: string) {}

  async getUsdPrice(mint: string): Promise<number | null> {
    const mintPk = new PublicKey(mint);
    const url = new URL(this.priceUrl);
    url.searchParams.set("ids", mintPk.toBase58());

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const price = data?.data?.[mintPk.toBase58()]?.price;
    return typeof price === "number" && Number.isFinite(price) ? price : null;
  }
}

