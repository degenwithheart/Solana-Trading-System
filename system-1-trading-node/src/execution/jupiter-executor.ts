import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { SignerClient } from "./signer-client";

export class JupiterExecutor {
  constructor(
    private readonly opts: {
      baseUrl: string;
      wsolMint: PublicKey;
      signer: SignerClient;
    }
  ) {}

  async swapSolToToken(params: {
    conn: Connection;
    outputMint: PublicKey;
    solLamports: bigint;
    userPublicKey: PublicKey;
    venue: {
      allowedDexLabels: string[];
      onlyDirectRoutes: boolean;
      slippageBps: number;
      maxPriorityFeeLamports: number;
      maxRetries: number;
      confirmationTimeoutMs: number;
    };
    mev?: { maxRouteSteps: number; maxPriceImpactPct: number; maxQuoteDriftBps: number };
  }): Promise<{ signature: string }> {
    const quote = await this.getQuote({
      inputMint: this.opts.wsolMint,
      outputMint: params.outputMint,
      amount: params.solLamports,
      slippageBps: params.venue.slippageBps,
      onlyDirectRoutes: params.venue.onlyDirectRoutes,
      allowedDexLabels: params.venue.allowedDexLabels,
      maxRouteSteps: params.mev?.maxRouteSteps,
      maxPriceImpactPct: params.mev?.maxPriceImpactPct,
      maxQuoteDriftBps: params.mev?.maxQuoteDriftBps
    });

    const swapTx = await this.swap({
      quoteResponse: quote,
      userPublicKey: params.userPublicKey,
      prioritizationFeeLamports: params.venue.maxPriorityFeeLamports
    });

    const txBuf = Buffer.from(swapTx.swapTransaction, "base64");
    const unsigned = VersionedTransaction.deserialize(txBuf);
    const signed = await this.opts.signer.signTransaction(unsigned);

    const sig = await params.conn.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: params.venue.maxRetries
    });

    await confirmWithTimeout(params.conn, sig, params.venue.confirmationTimeoutMs);
    return { signature: sig };
  }

  async swapTokenToSol(params: {
    conn: Connection;
    inputMint: PublicKey;
    tokenAmount: bigint;
    userPublicKey: PublicKey;
    venue: {
      allowedDexLabels: string[];
      onlyDirectRoutes: boolean;
      slippageBps: number;
      maxPriorityFeeLamports: number;
      maxRetries: number;
      confirmationTimeoutMs: number;
    };
    mev?: { maxRouteSteps: number; maxPriceImpactPct: number; maxQuoteDriftBps: number };
  }): Promise<{ signature: string }> {
    const quote = await this.getQuote({
      inputMint: params.inputMint,
      outputMint: this.opts.wsolMint,
      amount: params.tokenAmount,
      slippageBps: params.venue.slippageBps,
      onlyDirectRoutes: params.venue.onlyDirectRoutes,
      allowedDexLabels: params.venue.allowedDexLabels,
      maxRouteSteps: params.mev?.maxRouteSteps,
      maxPriceImpactPct: params.mev?.maxPriceImpactPct,
      maxQuoteDriftBps: params.mev?.maxQuoteDriftBps
    });

    const swapTx = await this.swap({
      quoteResponse: quote,
      userPublicKey: params.userPublicKey,
      prioritizationFeeLamports: params.venue.maxPriorityFeeLamports
    });

    const txBuf = Buffer.from(swapTx.swapTransaction, "base64");
    const unsigned = VersionedTransaction.deserialize(txBuf);
    const signed = await this.opts.signer.signTransaction(unsigned);

    const sig = await params.conn.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: params.venue.maxRetries
    });
    await confirmWithTimeout(params.conn, sig, params.venue.confirmationTimeoutMs);
    return { signature: sig };
  }

  async getQuote(params: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: bigint;
    slippageBps: number;
    onlyDirectRoutes: boolean;
    allowedDexLabels: string[];
    maxRouteSteps?: number;
    maxPriceImpactPct?: number;
    maxQuoteDriftBps?: number;
  }): Promise<any> {
    const first = await this.fetchQuote(params);
    if (typeof params.maxQuoteDriftBps === "number" && params.maxQuoteDriftBps > 0) {
      const second = await this.fetchQuote(params);
      const a = BigInt(String(first?.outAmount ?? "0"));
      const b = BigInt(String(second?.outAmount ?? "0"));
      const driftBps = quoteDriftBps(a, b);
      if (driftBps > params.maxQuoteDriftBps) throw new Error("Quote drift exceeded");
      return second;
    }
    return first;
  }

  private async fetchQuote(params: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: bigint;
    slippageBps: number;
    onlyDirectRoutes: boolean;
    allowedDexLabels: string[];
    maxRouteSteps?: number;
    maxPriceImpactPct?: number;
  }): Promise<any> {
    const url = new URL("/v6/quote", this.opts.baseUrl);
    url.searchParams.set("inputMint", params.inputMint.toBase58());
    url.searchParams.set("outputMint", params.outputMint.toBase58());
    url.searchParams.set("amount", params.amount.toString());
    url.searchParams.set("slippageBps", String(params.slippageBps));
    url.searchParams.set("onlyDirectRoutes", params.onlyDirectRoutes ? "true" : "false");

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status}`);
    const quote = (await res.json()) as any;

    const priceImpact = quote?.priceImpactPct;
    if (typeof params.maxPriceImpactPct === "number" && typeof priceImpact === "string") {
      const pct = Number(priceImpact) * 100;
      if (Number.isFinite(pct) && pct > params.maxPriceImpactPct) throw new Error("Price impact too high");
    }

    if (params.allowedDexLabels.length === 0) return quote;

    const allowed = new Set(params.allowedDexLabels.map((s) => s.toLowerCase()));
    const routePlan = quote?.routePlan;
    if (!Array.isArray(routePlan)) throw new Error("Jupiter quote missing routePlan");
    if (typeof params.maxRouteSteps === "number" && routePlan.length > params.maxRouteSteps) {
      throw new Error("Route steps exceeded");
    }
    const ok = routePlan.every((step: any) => {
      const label = String(step?.swapInfo?.label ?? "").toLowerCase();
      return label && allowed.has(label);
    });
    if (!ok) throw new Error("Jupiter route does not match allowedDexLabels");
    return quote;
  }

  private async swap(params: { quoteResponse: any; userPublicKey: PublicKey; prioritizationFeeLamports: number }): Promise<any> {
    const url = new URL("/v6/swap", this.opts.baseUrl);
    const body = {
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: Math.max(0, Math.floor(params.prioritizationFeeLamports))
    };
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Jupiter swap failed: ${res.status} ${text}`);
    }
    return (await res.json()) as any;
  }
}

async function confirmWithTimeout(conn: Connection, signature: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (true) {
    const status = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
    const v = status.value;
    if (v && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) return;
    if (v && v.err) throw new Error("Transaction failed");
    if (Date.now() - start > timeoutMs) throw new Error("Confirmation timeout");
    await new Promise((r) => setTimeout(r, 800));
  }
}

function quoteDriftBps(a: bigint, b: bigint): number {
  if (a === 0n && b === 0n) return 0;
  const hi = a > b ? a : b;
  const lo = a > b ? b : a;
  if (hi === 0n) return 0;
  const diff = hi - lo;
  return Number((diff * 10000n) / hi);
}
