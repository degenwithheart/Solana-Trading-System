import "./globals.css";
import type { Metadata } from "next";
import { ThemeProvider } from "../ui/theme";
import { ToastProvider } from "../ui/toast";
import { ThemeToggle } from "../components/theme-toggle";

export const metadata: Metadata = {
  title: "Solana Trading Dashboard",
  description: "Trading system dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <ToastProvider>
            <div className="min-h-screen">
              <header className="sticky top-0 z-40 border-b border-white/10 bg-background/70 backdrop-blur-xl">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
                  <div>
                    <div className="text-base font-semibold">Solana Trading Dashboard</div>
                    <div className="text-xs text-foreground/60">System 1 + System 2</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ThemeToggle />
                  </div>
                </div>
              </header>
              <main className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6">{children}</main>
            </div>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
