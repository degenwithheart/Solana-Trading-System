import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import process from "node:process";

const root = process.cwd();
const failures = [];
const warnings = [];

function must(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  must(Number.isFinite(major) && major >= 20, `Node.js 20+ required, found ${process.versions.node}`);
}

function checkStructure() {
  const requiredDirs = [
    "shared",
    "scripts",
    "system-1-trading-node/src",
    "system-2-signer/src",
    "system-3-web-ui/src"
  ];
  for (const d of requiredDirs) must(exists(d), `Missing directory: ${d}`);

  const requiredFiles = [
    "package.json",
    "README.md",
    ".gitignore",
    "RUNBOOK.md",
    "system-1-trading-node/package.json",
    "system-1-trading-node/tsconfig.json",
    "system-2-signer/package.json",
    "system-2-signer/tsconfig.json",
    "system-2-signer/policy.example.json",
    "system-3-web-ui/package.json",
    "system-3-web-ui/tsconfig.json"
  ];
  for (const f of requiredFiles) must(exists(f), `Missing file: ${f}`);
}

function checkConfigJson() {
  const configPath = exists("system-1-trading-node/config.json")
    ? "system-1-trading-node/config.json"
    : "system-1-trading-node/config.example.json";
  must(exists(configPath), "Missing System 1 config (config.json or config.example.json)");
  try {
    const cfg = JSON.parse(readText(configPath));
    const requiredTop = ["network", "platform", "constants", "controls", "execution", "profiles", "activeProfile", "rpc", "risk", "filters"];
    for (const k of requiredTop) must(cfg && Object.prototype.hasOwnProperty.call(cfg, k), `config missing '${k}'`);
  } catch {
    failures.push(`Invalid JSON: ${configPath}`);
  }
}

function checkEnvPlaceholders() {
  const envFiles = [
    "system-1-trading-node/.env",
    "system-2-signer/.env",
    "system-3-web-ui/.env.local"
  ];
  for (const f of envFiles) {
    if (!exists(f)) {
      warnings.push(`Not configured yet: ${f} (run 'npm run setup:env')`);
      continue;
    }
    const text = readText(f);
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const value = trimmed.slice(eq + 1).trim();
      if (/^your_.*_here$/i.test(value)) {
        failures.push(`Placeholder value found in ${f}: ${trimmed.slice(0, eq + 1)}<redacted>`);
        break;
      }
    }
  }
}

function checkSignerLocalhost() {
  if (!exists("system-2-signer/.env")) return;
  const text = readText("system-2-signer/.env");
  const hostLine = text
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith("HOST="))
    ?.trim();
  if (!hostLine) {
    warnings.push("system-2-signer/.env missing HOST= (expected 127.0.0.1)");
    return;
  }
  const host = hostLine.split("=", 2)[1] ?? "";
  must(host === "127.0.0.1" || host === "localhost", "Signer must bind to localhost only (HOST=127.0.0.1)");
}

function checkSignerPolicyFile() {
  if (!exists("system-2-signer/.env")) return;
  if (!exists("system-2-signer/policy.json")) {
    warnings.push("system-2-signer/policy.json missing (run 'npm run setup:env')");
  }
}

function checkNoHardcodedKeys() {
  const files = listFiles(root, (p) => /\.(ts|tsx|js|mjs)$/.test(p) && !p.includes("node_modules"));
  for (const abs of files) {
    const rel = path.relative(root, abs);
    const text = fs.readFileSync(abs, "utf8");
    if (/(PRIVATE_KEY|privateKey|secretKey)\s*=\s*['"][^'"]+['"]/.test(text)) {
      failures.push(`Possible hardcoded secret in ${rel}`);
      break;
    }
  }
}

async function checkPortFree(port) {
  return await new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host: "127.0.0.1" }, () => srv.close(() => resolve(true)));
  });
}

function listFiles(dir, predicate) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs, predicate));
    else if (predicate(abs)) out.push(abs);
  }
  return out;
}

async function main() {
  checkNodeVersion();
  checkStructure();
  checkConfigJson();
  checkEnvPlaceholders();
  checkSignerLocalhost();
  checkSignerPolicyFile();
  checkNoHardcodedKeys();

  const p3000 = await checkPortFree(3000);
  const p3001 = await checkPortFree(3001);
  warn(p3000, "Port 3000 is in use (System 1 uses 3000 by default)");
  warn(p3001, "Port 3001 is in use (System 2 uses 3001 by default)");

  if (warnings.length) {
    // eslint-disable-next-line no-console
    console.warn(`WARNINGS:\n- ${warnings.join("\n- ")}`);
  }
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.error(`FAILED:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("OK: validation passed");
}

await main();
