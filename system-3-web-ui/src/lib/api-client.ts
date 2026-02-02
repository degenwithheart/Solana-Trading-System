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

export type Controls = {
  pauseDiscovery: boolean;
  pauseEntries: boolean;
  pauseExits: boolean;
  killSwitch: boolean;
};

export type ControlsResponse = {
  controls: Controls;
  activeProfile: string;
  profiles: string[];
};

export type MintGovernance = { mint: string; mode: "ALLOW" | "BLOCK"; reason: string | null; updatedAt: string };

const baseUrl = "/api/trading";

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
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

export async function getControls(): Promise<ControlsResponse> {
  return await fetchJson<ControlsResponse>("/controls");
}

export async function getGovernance(): Promise<{ rules: MintGovernance[] }> {
  return await fetchJson<{ rules: MintGovernance[] }>("/governance");
}
