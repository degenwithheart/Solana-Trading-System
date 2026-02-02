import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import { z } from "zod";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { readEnv } from "./env";
import { Logger } from "./logger";
import { loadKeypair } from "./keypair";
import { validateTransaction } from "./tx-validate";
import { SlidingWindowCounter } from "./rate-limit";
import { loadPolicy } from "./policy";
import type { HealthStatus } from "../../shared/types";

dotenv.config();

async function main() {
  const env = readEnv(process.env);

  if (env.HOST !== "127.0.0.1" && env.HOST !== "localhost") {
    throw new Error("Signer must bind to localhost only (HOST=127.0.0.1)");
  }

  const log = new Logger({
    level: env.LOG_LEVEL,
    filePath: env.LOG_FILE,
    maxSizeMb: env.LOG_MAX_SIZE_MB,
    maxFiles: env.LOG_MAX_FILES,
    console: env.LOG_CONSOLE ?? true
  });

  const { keypair, publicKey } = loadKeypair({
    privateKeyBase58: env.PRIVATE_KEY || undefined,
    publicKeyBase58: env.PUBLIC_KEY || undefined,
    useKeychain: env.USE_KEYCHAIN ?? false,
    keychainService: env.KEYCHAIN_SERVICE
  });

  const allowedIps = new Set(env.ALLOWED_IPS.split(",").map((s) => s.trim()).filter(Boolean));

  const perMinute = new SlidingWindowCounter(60_000);
  const perHour = new SlidingWindowCounter(60 * 60_000);
  const perDay = new SlidingWindowCounter(24 * 60 * 60_000);

  const policy = loadPolicy(env.POLICY_PATH);
  const allowedPrograms = new Set<string>([
    ...policy.allowlistedProgramIds,
    ...env.ALLOWED_PROGRAMS.split(",").map((s) => s.trim()).filter(Boolean)
  ]);

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "512kb" }));

  app.use((req, res, next) => {
    const ip = (req.ip ?? "").replace("::ffff:", "");
    if (env.ENABLE_IP_ALLOWLIST && allowedIps.size > 0 && !allowedIps.has(ip) && ip !== "::1") {
      return res.status(403).json({ error: "forbidden" });
    }
    if (env.REQUIRE_API_KEY) {
      if (!env.API_KEY) return res.status(500).json({ error: "misconfigured_api_key" });
      const key = req.header("x-api-key") ?? "";
      if (key !== env.API_KEY) return res.status(401).json({ error: "unauthorized" });
    }
    const m = perMinute.hit();
    const h = perHour.hit();
    const d = perDay.hit();
    if (m > env.MAX_TRANSACTIONS_PER_MINUTE || h > env.MAX_TRANSACTIONS_PER_HOUR || d > env.MAX_TRANSACTIONS_PER_DAY) {
      return res.status(429).json({ error: "rate_limited" });
    }
    next();
  });

  app.get("/health", (_req, res) => {
    const payload: HealthStatus = {
      ok: true,
      service: "system-2-signer",
      version: "1.0.0",
      timestamp: new Date().toISOString()
    };
    res.json(payload);
  });

  app.get("/v1/public-key", (_req, res) => {
    res.json({ publicKey: publicKey.toBase58() });
  });

  app.post("/v1/sign-transaction", async (req, res) => {
    const schema = z.object({ transactionBase64: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_body" });

    const txBuf = Buffer.from(parsed.data.transactionBase64, "base64");
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(txBuf);
    } catch {
      return res.status(400).json({ error: "invalid_transaction" });
    }

    try {
      validateTransaction(tx, {
        enableProgramAllowlist: env.ENABLE_PROGRAM_ALLOWLIST ?? false,
        allowedPrograms,
        denyByDefault: policy.denyByDefault,
        requireSignerAsFeePayer: policy.requireSignerAsFeePayer,
        signerPublicKey: publicKey,
        limits: policy.limits,
        instructionDenyList: policy.instructionDenyList
      });
    } catch (e) {
      return res.status(400).json({ error: "transaction_rejected", details: e instanceof Error ? e.message : "" });
    }

    // Ensure signer pubkey is referenced in account keys (defense-in-depth).
    const keys = (tx.message as any).staticAccountKeys ?? (tx.message as any).accountKeys ?? [];
    const hasSigner = keys.some((k: PublicKey) => new PublicKey(k).equals(publicKey));
    if (!hasSigner) {
      return res.status(400).json({ error: "transaction_missing_signer" });
    }

    const start = Date.now();
    try {
      tx.sign([keypair]);
    } catch {
      return res.status(500).json({ error: "sign_failed" });
    }
    const signedB64 = Buffer.from(tx.serialize()).toString("base64");
    const elapsed = Date.now() - start;

    if (env.LOG_TRANSACTIONS) {
      log.info("tx_signed", { ms: elapsed, signatures: tx.signatures.map((s) => Buffer.from(s).toString("base64")) });
    }

    res.json({ signedTransactionBase64: signedB64, publicKey: publicKey.toBase58() });
  });

  app.listen(env.PORT, env.HOST, () => {
    log.info("signer_started", { host: env.HOST, port: env.PORT, publicKey: publicKey.toBase58() });
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
