import type { SettingsRepo } from "../db/repositories/settings";
import type { Logger } from "../utils/logger";

type AiPnlEvent = { ts: number; pnlSol: number; entryId: string };

const KEY_EVENTS = "ai.aiPnlEvents.v1";

export class AiStats {
  constructor(
    private readonly deps: {
      settings: SettingsRepo;
      log: Logger;
    }
  ) {}

  rolling24hPnlSol(nowMs: number): number {
    const events = this.readEvents();
    const pruned = prune(events, nowMs);
    if (pruned.changed) this.writeEvents(pruned.events);
    return sum(pruned.events);
  }

  recordAiClose(entryId: string, pnlSol: number, closedAtMs: number, lossLimitSol: number): { disabled: boolean; rollingPnlSol: number } {
    const events = this.readEvents();
    const pruned = prune(events, closedAtMs);
    const next: AiPnlEvent[] = [...pruned.events, { ts: closedAtMs, pnlSol, entryId }];
    const pruned2 = prune(next, closedAtMs);
    this.writeEvents(pruned2.events);
    const rolling = sum(pruned2.events);
    const disabled = rolling <= -Math.abs(lossLimitSol);
    if (disabled) {
      this.deps.log.warn("ai_circuit_breaker_tripped", { rollingPnlSol: rolling, lossLimitSol });
    }
    return { disabled, rollingPnlSol: rolling };
  }

  private readEvents(): AiPnlEvent[] {
    const raw = this.deps.settings.get(KEY_EVENTS);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as any;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((e) => ({ ts: Number(e?.ts), pnlSol: Number(e?.pnlSol), entryId: String(e?.entryId ?? "") }))
        .filter((e) => Number.isFinite(e.ts) && Number.isFinite(e.pnlSol) && e.entryId.length > 0);
    } catch {
      return [];
    }
  }

  private writeEvents(events: AiPnlEvent[]): void {
    this.deps.settings.set(KEY_EVENTS, JSON.stringify(events.slice(-500)));
  }
}

function prune(events: AiPnlEvent[], nowMs: number): { events: AiPnlEvent[]; changed: boolean } {
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  let changed = false;
  const out = events.filter((e) => {
    const ok = e.ts >= cutoff && e.ts <= nowMs + 5 * 60 * 1000;
    if (!ok) changed = true;
    return ok;
  });
  if (out.length !== events.length) changed = true;
  return { events: out, changed };
}

function sum(events: AiPnlEvent[]): number {
  let s = 0;
  for (const e of events) s += Number.isFinite(e.pnlSol) ? e.pnlSol : 0;
  return s;
}

