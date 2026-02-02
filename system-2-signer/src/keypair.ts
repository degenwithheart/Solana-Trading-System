import { execFileSync } from "node:child_process";
import process from "node:process";
import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";

export function loadKeypair(opts: {
  privateKeyBase58?: string;
  publicKeyBase58?: string;
  useKeychain: boolean;
  keychainService: string;
}): { keypair: Keypair; publicKey: PublicKey } {
  const base58Key = opts.useKeychain ? readFromKeychain(opts.keychainService) : (opts.privateKeyBase58 ?? "");
  if (!base58Key) throw new Error("PRIVATE_KEY is required (or enable USE_KEYCHAIN)");

  const secret = bs58.decode(base58Key.trim());
  let keypair: Keypair;
  if (secret.length === 64) {
    keypair = Keypair.fromSecretKey(secret, { skipValidation: false });
  } else if (secret.length === 32) {
    keypair = Keypair.fromSeed(secret);
  } else {
    throw new Error("Unsupported private key length (expected 32 or 64 bytes after base58 decode)");
  }

  const pub = keypair.publicKey;
  if (opts.publicKeyBase58) {
    const expected = new PublicKey(opts.publicKeyBase58);
    if (!expected.equals(pub)) throw new Error("PUBLIC_KEY does not match PRIVATE_KEY");
  }
  return { keypair, publicKey: pub };
}

function readFromKeychain(service: string): string {
  // macOS Keychain integration: store a generic password with “security add-generic-password”.
  // This reads the password value only (no placeholder behavior).
  if (process.platform !== "darwin") {
    throw new Error("USE_KEYCHAIN is only supported on macOS");
  }
  try {
    return execFileSync("/usr/bin/security", ["find-generic-password", "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    throw new Error("Failed to read private key from macOS Keychain");
  }
}
