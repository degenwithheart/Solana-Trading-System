import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const pairs = [
  ["system-1-trading-node/.env.example", "system-1-trading-node/.env"],
  ["system-1-trading-node/config.example.json", "system-1-trading-node/config.json"],
  ["system-2-signer/.env.example", "system-2-signer/.env"],
  ["system-2-signer/policy.example.json", "system-2-signer/policy.json"],
  ["system-3-web-ui/.env.local.example", "system-3-web-ui/.env.local"]
];

function mergeConfigExample() {
  const examplePath = path.join(root, "system-1-trading-node", "config.example.json");
  const configPath = path.join(root, "system-1-trading-node", "config.json");
  if (!fs.existsSync(examplePath)) return;
  if (!fs.existsSync(configPath)) return;
  try {
    const example = JSON.parse(fs.readFileSync(examplePath, "utf8"));
    const current = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const merged = deepMerge(example, current);
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
    // eslint-disable-next-line no-console
    console.log("Upgraded system-1-trading-node/config.json with new defaults (preserved your overrides)");
  } catch {
    // ignore
  }
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (base && typeof base === "object" && override && typeof override === "object") {
    const out = { ...base };
    for (const [k, v] of Object.entries(override)) {
      out[k] = k in base ? deepMerge(base[k], v) : v;
    }
    return out;
  }
  return override ?? base;
}

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

mergeConfigExample();
