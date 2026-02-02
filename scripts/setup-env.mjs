import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const pairs = [
  ["system-1-trading-node/.env.example", "system-1-trading-node/.env"],
  ["system-1-trading-node/config.example.json", "system-1-trading-node/config.json"],
  ["system-2-signer/.env.example", "system-2-signer/.env"],
  ["system-3-web-ui/.env.local.example", "system-3-web-ui/.env.local"]
];

for (const [srcRel, dstRel] of pairs) {
  const src = path.join(root, srcRel);
  const dst = path.join(root, dstRel);
  if (!fs.existsSync(src)) throw new Error(`Missing template: ${srcRel}`);
  if (fs.existsSync(dst)) continue;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  if (dstRel.endsWith("/.env")) {
    // Best-effort secure permissions (no-op on some Windows setups).
    try {
      fs.chmodSync(dst, 0o600);
    } catch {
      // ignore
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Created ${dstRel}`);
}

