"use client";

import { createContext, useContext, useMemo, useState } from "react";

type ToastItem = { id: string; kind: "success" | "error" | "info"; message: string };

const ToastCtx = createContext<{ push: (t: Omit<ToastItem, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const api = useMemo(
    () => ({
      push: (t: Omit<ToastItem, "id">) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const item: ToastItem = { id, ...t };
        setToasts((prev) => [item, ...prev].slice(0, 5));
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3500);
      }
    }),
    []
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
            <span className={t.kind === "success" ? "text-emerald-300" : t.kind === "error" ? "text-red-300" : "text-sky-300"}>
              {t.kind.toUpperCase()}
            </span>
            <span className="text-foreground/90">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    return {
      success: (_: string) => undefined,
      error: (_: string) => undefined,
      info: (_: string) => undefined
    };
  }
  return {
    success: (message: string) => ctx.push({ kind: "success", message }),
    error: (message: string) => ctx.push({ kind: "error", message }),
    info: (message: string) => ctx.push({ kind: "info", message })
  };
}

