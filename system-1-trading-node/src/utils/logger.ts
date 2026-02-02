import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LoggerOptions = {
  level: LogLevel;
  filePath: string;
  maxSizeMb: number;
  maxFiles: number;
  console: boolean;
};

type LogRecord = {
  ts: string;
  level: LogLevel;
  msg: string;
  data?: unknown;
};

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "non-serializable" });
  }
}

function ensureDirForFile(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function rotateIfNeeded(filePath: string, maxSizeBytes: number, maxFiles: number) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < maxSizeBytes) return;
  } catch {
    return;
  }

  for (let i = maxFiles - 1; i >= 1; i--) {
    const src = `${filePath}.${i}`;
    const dst = `${filePath}.${i + 1}`;
    if (fs.existsSync(src)) {
      try {
        fs.renameSync(src, dst);
      } catch {
        // ignore rotation failures to keep service running
      }
    }
  }

  try {
    fs.renameSync(filePath, `${filePath}.1`);
  } catch {
    // ignore
  }
}

export class Logger {
  private readonly opts: LoggerOptions;

  constructor(opts: LoggerOptions) {
    this.opts = opts;
    ensureDirForFile(this.opts.filePath);
  }

  private write(level: LogLevel, msg: string, data?: unknown) {
    if (levelRank[level] < levelRank[this.opts.level]) return;

    const rec: LogRecord = { ts: new Date().toISOString(), level, msg };
    if (data !== undefined) rec.data = data;
    const line = `${safeJson(rec)}\n`;

    const maxSizeBytes = Math.max(1, this.opts.maxSizeMb) * 1024 * 1024;
    rotateIfNeeded(this.opts.filePath, maxSizeBytes, Math.max(1, this.opts.maxFiles));

    try {
      fs.appendFileSync(this.opts.filePath, line, { encoding: "utf8" });
    } catch {
      // ignore
    }

    if (this.opts.console) {
      // Keep console output compact and safe.
      const preview = data === undefined ? "" : ` ${safeJson(data)}`;
      // eslint-disable-next-line no-console
      console.log(`[${rec.ts}] ${level.toUpperCase()} ${msg}${preview}`);
    }
  }

  debug(msg: string, data?: unknown) {
    this.write("debug", msg, data);
  }
  info(msg: string, data?: unknown) {
    this.write("info", msg, data);
  }
  warn(msg: string, data?: unknown) {
    this.write("warn", msg, data);
  }
  error(msg: string, data?: unknown) {
    this.write("error", msg, data);
  }
}

