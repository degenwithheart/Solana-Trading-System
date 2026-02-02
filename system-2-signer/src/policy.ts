import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const zSignerPolicy = z.object({
  denyByDefault: z.boolean().default(true),
  allowlistedProgramIds: z.array(z.string().min(32)).default([]),
  instructionDenyList: z
    .array(
      z.object({
        programId: z.string().min(32),
        encoding: z.enum(["u8", "u32le"]),
        deny: z.array(z.number().int().min(0).max(0xffffffff))
      })
    )
    .default([]),
  limits: z
    .object({
      maxLamportsPerTransaction: z.number().int().min(0).default(2_000_000_000),
      maxComputeUnitPriceMicroLamports: z.number().int().min(0).default(2_000_000),
      maxComputeUnits: z.number().int().min(0).default(1_400_000)
    })
    .default({
      maxLamportsPerTransaction: 2_000_000_000,
      maxComputeUnitPriceMicroLamports: 2_000_000,
      maxComputeUnits: 1_400_000
    }),
  requireSignerAsFeePayer: z.boolean().default(true)
});

export type SignerPolicy = z.infer<typeof zSignerPolicy>;

export function loadPolicy(policyPath: string): SignerPolicy {
  const abs = path.resolve(process.cwd(), policyPath);
  const raw = fs.readFileSync(abs, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return zSignerPolicy.parse(parsed);
}
