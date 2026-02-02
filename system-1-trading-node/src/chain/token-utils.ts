import { PublicKey, type Connection } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

export async function getMintDecimals(conn: Connection, mint: PublicKey): Promise<number> {
  const info = await conn.getParsedAccountInfo(mint, "confirmed");
  if (!info.value) throw new Error("Mint not found");
  const data = info.value.data as any;
  const decimals = data?.parsed?.info?.decimals;
  if (typeof decimals !== "number") throw new Error("Unable to read mint decimals");
  return decimals;
}

export async function getAta(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  return await getAssociatedTokenAddress(mint, owner, false);
}

export async function getTokenBalanceRaw(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const ata = await getAta(owner, mint);
  const bal = await conn.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  const amount = bal?.value?.amount;
  if (!amount) return 0n;
  try {
    return BigInt(amount);
  } catch {
    return 0n;
  }
}

