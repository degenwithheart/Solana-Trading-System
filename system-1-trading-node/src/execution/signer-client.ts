import { PublicKey, VersionedTransaction } from "@solana/web3.js";

export type SignerClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  apiKey?: string;
};

export class SignerClient {
  constructor(private readonly opts: SignerClientOptions) {}

  async health(): Promise<boolean> {
    const res = await this.request("GET", "/health");
    return res.ok;
  }

  async getPublicKey(): Promise<PublicKey> {
    const res = await this.request("GET", "/v1/public-key");
    if (!res.ok) throw new Error(`Signer error: ${res.status}`);
    const data = (await res.json()) as any;
    return new PublicKey(String(data.publicKey));
  }

  async signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction> {
    const payload = {
      transactionBase64: Buffer.from(tx.serialize()).toString("base64")
    };
    const res = await this.request("POST", "/v1/sign-transaction", payload);
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Signer error: ${res.status} ${text}`);
    }
    const data = (await res.json()) as any;
    const signed = Buffer.from(String(data.signedTransactionBase64), "base64");
    return VersionedTransaction.deserialize(signed);
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= Math.max(0, this.opts.retries); attempt++) {
      try {
        const url = new URL(path, this.opts.baseUrl);
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (this.opts.apiKey) headers["x-api-key"] = this.opts.apiKey;
        const res = await fetch(url.toString(), {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.opts.timeoutMs)
        });
        return res;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Signer request failed");
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

