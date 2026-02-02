import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Solana Trading Dashboard",
  description: "Trading system dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-white/10">
            <div className="mx-auto max-w-5xl px-6 py-4">
              <div className="text-lg font-semibold">Solana Trading Dashboard</div>
              <div className="text-sm text-white/60">System 1 + System 2 status</div>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}

