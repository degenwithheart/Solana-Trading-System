"use client";

import { useMemo, useState, useTransition } from "react";
import type { Controls, ControlsResponse } from "../lib/api-client";
import { useToast } from "../ui/toast";

export function ControlsPanel(props: { initial: ControlsResponse }) {
  const [state, setState] = useState(props.initial);
  const [pending, start] = useTransition();
  const toast = useToast();

  const profiles = useMemo(() => state.profiles.slice().sort(), [state.profiles]);

  function updateControls(patch: Partial<Controls> & { activeProfile?: string }) {
    start(async () => {
      const res = await fetch("/api/trading/controls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!res.ok) {
        toast.error("Failed to update controls");
        return;
      }
      const next = await fetch("/api/trading/controls", { cache: "no-store" }).then((r) => r.json());
      setState(next);
      toast.success("Updated");
    });
  }

  function closeAll() {
    start(async () => {
      const res = await fetch("/api/trading/controls/close-all", { method: "POST" });
      if (!res.ok) {
        toast.error("Failed to close all");
        return;
      }
      const next = await fetch("/api/trading/controls", { cache: "no-store" }).then((r) => r.json());
      setState(next);
      toast.info("Kill switch armed");
    });
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm text-white/60">Controls</div>
          <div className="text-lg font-semibold">Trading Node</div>
          <div className="text-xs text-white/50">{pending ? "Updating…" : ""}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
            onClick={() => updateControls({ pauseDiscovery: !state.controls.pauseDiscovery })}
            disabled={pending}
          >
            Discovery: {state.controls.pauseDiscovery ? "Paused" : "On"}
          </button>
          <button
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
            onClick={() => updateControls({ pauseEntries: !state.controls.pauseEntries })}
            disabled={pending}
          >
            Entries: {state.controls.pauseEntries ? "Paused" : "On"}
          </button>
          <button
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
            onClick={() => updateControls({ pauseExits: !state.controls.pauseExits })}
            disabled={pending}
          >
            Exits: {state.controls.pauseExits ? "Paused" : "On"}
          </button>
          <button
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm"
            onClick={() => updateControls({ killSwitch: !state.controls.killSwitch })}
            disabled={pending}
          >
            Kill: {state.controls.killSwitch ? "Armed" : "Off"}
          </button>
          <button
            className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm"
            onClick={closeAll}
            disabled={pending}
          >
            Close All
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="text-sm text-white/60">Profile</div>
        <select
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm sm:w-64"
          value={state.activeProfile}
          onChange={(e) => updateControls({ activeProfile: e.target.value })}
          disabled={pending}
        >
          {profiles.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
