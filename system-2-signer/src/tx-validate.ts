import { PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";

export type TxValidationConfig = {
  enableProgramAllowlist: boolean;
  allowedPrograms: Set<string>;
  enableAmountLimits: boolean;
  maxTransactionAmountSol: number;
};

export function validateTransaction(tx: VersionedTransaction, cfg: TxValidationConfig): void {
  const msg: any = tx.message as any;
  const keys: PublicKey[] = msg.staticAccountKeys ?? msg.accountKeys ?? [];
  const compiled = msg.compiledInstructions ?? msg.instructions ?? [];

  for (const ix of compiled) {
    const programIdIndex = Number(ix.programIdIndex);
    const programId = keys[programIdIndex]?.toBase58();
    if (!programId) throw new Error("Invalid instruction program id");
    if (cfg.enableProgramAllowlist && cfg.allowedPrograms.size > 0 && !cfg.allowedPrograms.has(programId)) {
      throw new Error(`Program not allowlisted: ${programId}`);
    }

    if (cfg.enableAmountLimits && programId === SystemProgram.programId.toBase58()) {
      // For SystemProgram transfers, best-effort decode the lamports amount.
      // Compiled instruction data is base58/base64 depending on serialization; web3 uses base64 for JSON, but here we have bytes.
      const data: Uint8Array = ix.data ?? new Uint8Array();
      // SystemProgram transfer layout: 4-byte instruction index (2) + 8-byte lamports LE.
      if (data.length >= 12) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const ixType = view.getUint32(0, true);
        if (ixType === 2) {
          const lamports = view.getBigUint64(4, true);
          const sol = Number(lamports) / 1e9;
          if (sol > cfg.maxTransactionAmountSol) throw new Error("Transaction amount exceeds limit");
        }
      }
    }
  }
}

