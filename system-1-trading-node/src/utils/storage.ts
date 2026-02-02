import fs from "node:fs";
import path from "node:path";

export class JsonFileStorage<T> {
  private readonly dir: string;
  private readonly file: string;
  private readonly maxSizeBytes: number;

  constructor(opts: { dir: string; filename: string; maxSizeMb: number }) {
    this.dir = opts.dir;
    this.file = path.join(this.dir, opts.filename);
    this.maxSizeBytes = Math.max(1, opts.maxSizeMb) * 1024 * 1024;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  read(defaultValue: T): T {
    try {
      const buf = fs.readFileSync(this.file);
      if (buf.length > this.maxSizeBytes) return defaultValue;
      return JSON.parse(buf.toString("utf8")) as T;
    } catch {
      return defaultValue;
    }
  }

  write(value: T): void {
    const tmp = `${this.file}.tmp`;
    const data = Buffer.from(JSON.stringify(value, null, 2), "utf8");
    if (data.length > this.maxSizeBytes) {
      throw new Error("Refusing to write oversized storage file");
    }
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

