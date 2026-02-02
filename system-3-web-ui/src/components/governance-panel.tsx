"use client";

import { useEffect, useState, useTransition } from "react";
import type { MintGovernance } from "../lib/api-client";
import { useToast } from "../ui/toast";

export function GovernancePanel(props: { initial: MintGovernance[] }) {
  const [rules, setRules] = useState(props.initial);
  const [mint, setMint] = useState("");
  const [mode, setMode] = useState<"ALLOW" | "BLOCK">("BLOCK");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();

  async function refresh() {
    const next = await fetch("/api/trading/governance", { cache: "no-store" }).then((r) => r.json());
    setRules(next.rules ?? []);
  }

  useEffect(() => {
    // keep fresh in background
    const t = setInterval(() => refresh().catch(() => undefined), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-foreground/60">Governance</div>
          <div className="text-lg font-semibold">Mint allow/block rules</div>
        </div>
        <button
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm hover:bg-black/30 disabled:opacity-60"
          disabled={pending}
          onClick={() => start(async () => refresh().catch(() => toast.error("Refresh failed")))}
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <input
          value={mint}
          onChange={(e) => setMint(e.target.value)}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20 sm:col-span-2"
          placeholder="Mint address"
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as any)}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
        >
          <option value="BLOCK">BLOCK</option>
          <option value="ALLOW">ALLOW</option>
        </select>
        <button
          className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await fetch("/api/trading/governance", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ mint, mode, reason: reason || undefined })
              });
              if (!res.ok) {
                toast.error("Failed to save rule");
                return;
              }
              toast.success("Rule saved");
              setMint("");
              setReason("");
              await refresh();
            })
          }
        >
          Save
        </button>
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
        placeholder="Reason (optional)"
      />

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-foreground/60">
            <tr>
              <th className="py-2 pr-4">Mint</th>
              <th className="py-2 pr-4">Mode</th>
              <th className="py-2 pr-4">Reason</th>
              <th className="py-2 pr-4">Updated</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.mint} className="border-t border-white/10">
                <td className="py-2 pr-4 font-mono text-xs">{r.mint}</td>
                <td className="py-2 pr-4">{r.mode}</td>
                <td className="py-2 pr-4 text-foreground/70">{r.reason ?? ""}</td>
                <td className="py-2 pr-4 text-foreground/70">{new Date(r.updatedAt).toLocaleString()}</td>
                <td className="py-2 pr-4">
                  <button
                    className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs hover:bg-black/30 disabled:opacity-60"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await fetch(`/api/trading/governance/${r.mint}`, { method: "DELETE" });
                        if (!res.ok) {
                          toast.error("Failed to delete");
                          return;
                        }
                        toast.info("Rule deleted");
                        await refresh();
                      })
                    }
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rules.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-foreground/60">
                  No rules yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

