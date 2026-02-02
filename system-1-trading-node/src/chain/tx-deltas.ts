import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";

export function getSolDeltaFromTx(tx: ParsedTransactionWithMeta, owner: PublicKey): number {
  const meta = tx.meta;
  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const idx = keys.findIndex((k) => k.equals(owner));
  if (idx === -1) throw new Error("Owner not in transaction keys");
  const pre = meta?.preBalances?.[idx];
  const post = meta?.postBalances?.[idx];
  if (typeof pre !== "number" || typeof post !== "number") throw new Error("Missing SOL balances");
  return (post - pre) / 1e9;
}

export function getTokenDeltaRawFromTx(tx: ParsedTransactionWithMeta, owner: PublicKey, mint: PublicKey): { delta: bigint; decimals: number } {
  const meta = tx.meta;
  const pre = meta?.preTokenBalances ?? [];
  const post = meta?.postTokenBalances ?? [];

  const ownerStr = owner.toBase58();
  const mintStr = mint.toBase58();

  const preEntry = pre.find((b: any) => b.mint === mintStr && (b.owner === ownerStr || b.owner === undefined));
  const postEntry = post.find((b: any) => b.mint === mintStr && (b.owner === ownerStr || b.owner === undefined));

  const preAmt = BigInt(preEntry?.uiTokenAmount?.amount ?? "0");
  const postAmt = BigInt(postEntry?.uiTokenAmount?.amount ?? "0");
  const decimals = Number(postEntry?.uiTokenAmount?.decimals ?? preEntry?.uiTokenAmount?.decimals ?? 0);
  return { delta: postAmt - preAmt, decimals };
}

