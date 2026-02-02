import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { TradingConfig } from "../../../shared/types";
import { SignerClient } from "./signer-client";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export class JupiterExecutor {
  constructor(
    private readonly opts: {
      baseUrl: string;
      config: TradingConfig["execution"];
      signer: SignerClient;
    }
  ) {}

  async swapSolToToken(params: {
    conn: Connection;
    outputMint: PublicKey;
    solLamports: bigint;
    userPublicKey: PublicKey;
  }): Promise<{ signature: string }> {
    const quote = await this.quote({
      inputMint: WSOL_MINT,
      outputMint: params.outputMint,
      amount: params.solLamports,
      slippageBps: this.opts.config.slippageBps
    });

    const swapTx = await this.swap({
      quoteResponse: quote,
      userPublicKey: params.userPublicKey
    });

    const txBuf = Buffer.from(swapTx.swapTransaction, "base64");
    const unsigned = VersionedTransaction.deserialize(txBuf);
    const signed = await this.opts.signer.signTransaction(unsigned);

    const sig = await params.conn.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: this.opts.config.maxRetries
    });

    await params.conn.confirmTransaction(sig, "confirmed");
    return { signature: sig };
  }

  private async quote(params: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: bigint;
    slippageBps: number;
  }): Promise<any> {
    const url = new URL("/v6/quote", this.opts.baseUrl);
    url.searchParams.set("inputMint", params.inputMint.toBase58());
    url.searchParams.set("outputMint", params.outputMint.toBase58());
    url.searchParams.set("amount", params.amount.toString());
    url.searchParams.set("slippageBps", String(params.slippageBps));
    url.searchParams.set("onlyDirectRoutes", "false");

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status}`);
    return (await res.json()) as any;
  }

  private async swap(params: { quoteResponse: any; userPublicKey: PublicKey }): Promise<any> {
    const url = new URL("/v6/swap", this.opts.baseUrl);
    const body = {
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true
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

