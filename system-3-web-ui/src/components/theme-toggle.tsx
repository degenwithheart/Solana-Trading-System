"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme, systemTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const current = theme === "system" ? systemTheme : theme;
  const next = current === "dark" ? "light" : "dark";

  return (
    <button
      className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm hover:bg-black/30"
      onClick={() => setTheme(next ?? "dark")}
      aria-label="Toggle theme"
    >
      {current === "dark" ? "Dark" : "Light"}
    </button>
  );
}

