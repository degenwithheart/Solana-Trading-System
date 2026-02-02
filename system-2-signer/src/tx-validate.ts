import { PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import type { SignerPolicy } from "./policy";

export type TxValidationConfig = {
  enableProgramAllowlist: boolean;
  allowedPrograms: Set<string>;
  denyByDefault: boolean;
  requireSignerAsFeePayer: boolean;
  signerPublicKey: PublicKey;
  limits: {
    maxLamportsPerTransaction: number;
    maxComputeUnitPriceMicroLamports: number;
    maxComputeUnits: number;
  };
  instructionDenyList: SignerPolicy["instructionDenyList"];
};

export function validateTransaction(tx: VersionedTransaction, cfg: TxValidationConfig): void {
  const msg: any = tx.message as any;
  const keys: PublicKey[] = msg.staticAccountKeys ?? msg.accountKeys ?? [];
  const compiled = msg.compiledInstructions ?? msg.instructions ?? [];

  if (cfg.requireSignerAsFeePayer) {
    const feePayer = keys[0];
    if (!feePayer || !feePayer.equals(cfg.signerPublicKey)) {
      throw new Error("Fee payer must be the signer");
    }
  }

  let lamportsOut = 0n;
  let maxCuPriceMicro = 0n;
  let maxCuLimit = 0n;

  for (const ix of compiled) {
    const programIdIndex = Number(ix.programIdIndex);
    const programId = keys[programIdIndex]?.toBase58();
    if (!programId) throw new Error("Invalid instruction program id");
    if (cfg.enableProgramAllowlist && cfg.denyByDefault) {
      if (!cfg.allowedPrograms.has(programId)) throw new Error(`Program not allowlisted: ${programId}`);
    } else if (cfg.enableProgramAllowlist && cfg.allowedPrograms.size > 0) {
      if (!cfg.allowedPrograms.has(programId)) throw new Error(`Program not allowlisted: ${programId}`);
    }

    const data: Uint8Array = ix.data ?? new Uint8Array();

    // Instruction deny list
    const denyRule = cfg.instructionDenyList.find((r) => r.programId === programId);
    if (denyRule && denyRule.deny.length > 0) {
      const disc = decodeDiscriminator(data, denyRule.encoding);
      if (disc !== null && denyRule.deny.includes(disc)) {
        throw new Error("Instruction denied by policy");
      }
    }

    if (programId === SystemProgram.programId.toBase58()) {
      // SystemProgram: 4-byte instruction index + args.
      if (data.length >= 12) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const ixType = view.getUint32(0, true);
        // 0 = CreateAccount, 2 = Transfer, 3 = CreateAccountWithSeed
        if (ixType === 0 || ixType === 2 || ixType === 3) {
          const lamports = view.getBigUint64(4, true);
          lamportsOut += lamports;
        }
      }
    }

    // ComputeBudget program decoding (best-effort): tag byte then args.
    // tag 2: SetComputeUnitLimit(u32), tag 3: SetComputeUnitPrice(u64 microLamports)
    if (data.length >= 1) {
      const tag = data[0];
      if (tag === 2 && data.length >= 5) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const units = BigInt(view.getUint32(1, true));
        if (units > maxCuLimit) maxCuLimit = units;
      }
      if (tag === 3 && data.length >= 9) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const price = view.getBigUint64(1, true);
        if (price > maxCuPriceMicro) maxCuPriceMicro = price;
      }
    }
  }

  if (lamportsOut > BigInt(cfg.limits.maxLamportsPerTransaction)) {
    throw new Error("Lamports outflow exceeds policy limit");
  }
  if (maxCuPriceMicro > BigInt(cfg.limits.maxComputeUnitPriceMicroLamports)) {
    throw new Error("Compute unit price exceeds policy limit");
  }
  if (maxCuLimit > BigInt(cfg.limits.maxComputeUnits)) {
    throw new Error("Compute unit limit exceeds policy limit");
  }
}

function decodeDiscriminator(data: Uint8Array, encoding: "u8" | "u32le"): number | null {
  if (encoding === "u8") return data.length >= 1 ? data[0] : null;
  if (data.length < 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint32(0, true);
}
