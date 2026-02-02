"use client";

import { useState, useTransition } from "react";
import { useToast } from "../../ui/toast";

export default function UnlockForm(props: { nextPath: string }) {
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="glass rounded-2xl p-6">
          <div className="text-sm text-foreground/70">Protected Dashboard</div>
          <div className="mt-1 text-xl font-semibold">Enter access password</div>

          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await fetch("/api/unlock", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ password })
                });
                if (!res.ok) {
                  toast.error("Access denied");
                  return;
                }
                toast.success("Access granted");
                window.location.href = props.nextPath || "/";
              });
            }}
          >
            <label className="block text-sm text-foreground/70">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
              placeholder="••••••••"
              autoFocus
            />
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
            >
              {pending ? "Checking…" : "Unlock"}
            </button>
            <div className="text-xs text-foreground/60">
              Set `UI_ACCESS_PASSWORD` in `system-3-web-ui/.env.local` to enable/disable this gate.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

