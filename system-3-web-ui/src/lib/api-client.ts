export type Health = {
  ok: boolean;
  service: string;
  version: string;
  timestamp: string;
};

export type OrchestratorStatus = {
  running: boolean;
  lastTickAt?: string;
  lastError?: string;
  candidates: number;
  openPositions: number;
};

export type Position = {
  id: string;
  mint: string;
  openedAt: string;
  sizeSol: number;
  entrySignature?: string;
  exitSignature?: string;
  status: "OPEN" | "CLOSED" | "FAILED";
  pnlSol?: number;
  notes?: string;
};

const baseUrl = process.env.NEXT_PUBLIC_TRADING_NODE_URL ?? "http://localhost:3000";

export async function fetchJson<T>(path: string): Promise<T> {
  const url = new URL(path, baseUrl);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function getTradingHealth(): Promise<Health> {
  return await fetchJson<Health>("/health");
}

export async function getTradingStatus(): Promise<{ status: OrchestratorStatus }> {
  return await fetchJson<{ status: OrchestratorStatus }>("/status");
}

export async function getPositions(): Promise<{ positions: Position[] }> {
  return await fetchJson<{ positions: Position[] }>("/positions");
}

