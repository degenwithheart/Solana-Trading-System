import { getPositions, getTradingHealth, getTradingStatus } from "../lib/api-client";

export default async function Page() {
  const [health, status, positions] = await Promise.allSettled([
    getTradingHealth(),
    getTradingStatus(),
    getPositions()
  ]);

  const healthVal = health.status === "fulfilled" ? health.value : null;
  const statusVal = status.status === "fulfilled" ? status.value.status : null;
  const positionsVal = positions.status === "fulfilled" ? positions.value.positions : [];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-white/60">Trading Node</div>
            <div className="text-xl font-semibold">{healthVal?.ok ? "Healthy" : "Unavailable"}</div>
            <div className="text-xs text-white/50">{healthVal?.timestamp ?? ""}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-white/60">Orchestrator</div>
            <div className="text-xl font-semibold">{statusVal?.running ? "Running" : "Stopped"}</div>
            <div className="text-xs text-white/50">{statusVal?.lastError ? `Error: ${statusVal.lastError}` : ""}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Candidates" value={statusVal?.candidates ?? 0} />
          <Stat label="Open Positions" value={statusVal?.openPositions ?? 0} />
          <Stat label="Last Tick" value={statusVal?.lastTickAt ?? "—"} />
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">Positions</div>
          <div className="text-sm text-white/60">{positionsVal.length} total</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-white/60">
              <tr>
                <th className="py-2 pr-4">Mint</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Size (SOL)</th>
                <th className="py-2 pr-4">Opened</th>
              </tr>
            </thead>
            <tbody>
              {positionsVal.map((p) => (
                <tr key={p.id} className="border-t border-white/10">
                  <td className="py-2 pr-4 font-mono text-xs">{p.mint}</td>
                  <td className="py-2 pr-4">{p.status}</td>
                  <td className="py-2 pr-4">{p.sizeSol.toFixed(4)}</td>
                  <td className="py-2 pr-4">{new Date(p.openedAt).toLocaleString()}</td>
                </tr>
              ))}
              {positionsVal.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-white/50">
                    No positions yet. Add a candidate mint via the trading node API: POST /candidates
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="text-xs text-white/60">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

