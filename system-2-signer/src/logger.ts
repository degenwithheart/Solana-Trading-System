import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

type LogRecord = {
  ts: string;
  level: LogLevel;
  msg: string;
  data?: unknown;
};

const levelRank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor(
    private readonly opts: { level: LogLevel; filePath: string; maxSizeMb: number; maxFiles: number; console: boolean }
  ) {
    fs.mkdirSync(path.dirname(this.opts.filePath), { recursive: true });
  }

  private write(level: LogLevel, msg: string, data?: unknown) {
    if (levelRank[level] < levelRank[this.opts.level]) return;
    const rec: LogRecord = { ts: new Date().toISOString(), level, msg, data };
    const line = `${safeJson(rec)}\n`;
    rotateIfNeeded(this.opts.filePath, this.opts.maxSizeMb * 1024 * 1024, this.opts.maxFiles);
    try {
      fs.appendFileSync(this.opts.filePath, line, { encoding: "utf8" });
    } catch {
      // ignore
    }
    if (this.opts.console) {
      // eslint-disable-next-line no-console
      console.log(`[${rec.ts}] ${level.toUpperCase()} ${msg}${data === undefined ? "" : ` ${safeJson(data)}`}`);
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

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return JSON.stringify({ error: "non-serializable" });
  }
}

function rotateIfNeeded(filePath: string, maxBytes: number, maxFiles: number) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < Math.max(1, maxBytes)) return;
  } catch {
    return;
  }
  for (let i = Math.max(1, maxFiles) - 1; i >= 1; i--) {
    const src = `${filePath}.${i}`;
    const dst = `${filePath}.${i + 1}`;
    if (fs.existsSync(src)) {
      try {
        fs.renameSync(src, dst);
      } catch {
        // ignore
      }
    }
  }
  try {
    fs.renameSync(filePath, `${filePath}.1`);
  } catch {
    // ignore
  }
}

