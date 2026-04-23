// Minimal dashboard shell. Sidebar nav matches the v0.2 preview slide:
//   Overview · API keys · Activity · Receipts · Settings
// Only "API keys" is wired in v0.2 — the rest go to placeholder pages.

import Link from "next/link";
import type { ReactNode } from "react";

type NavItem = { href: string; label: string; live: boolean };

const NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Overview", live: true },
  { href: "/dashboard/keys", label: "API keys", live: true },
  { href: "/dashboard/agents", label: "Agents", live: true },
  { href: "/dashboard/activity", label: "Activity", live: false },
  { href: "/dashboard/receipts", label: "Receipts", live: false },
  { href: "/dashboard/settings", label: "Settings", live: false },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-mint-50 text-ink-700">
      <header className="border-b border-mint-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="h-8 w-8 rounded-lg"
              style={{
                background:
                  "radial-gradient(120% 120% at 30% 20%, #1fb3a3 0%, #0d7a7a 55%, #083f3f 100%)",
              }}
            />
            <Link href="/" className="text-lg font-extrabold tracking-tight text-teal-800">
              FlowLink
            </Link>
            <span className="ml-3 rounded-full border border-mint-200 bg-mint-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-teal-700">
              Dashboard
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            Local admin
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-[200px_1fr] gap-6 px-6 py-8">
        <aside className="rounded-xl border border-mint-200 bg-white p-3">
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.live ? item.href : "#"}
                aria-disabled={!item.live}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold ${
                  item.live
                    ? "text-ink-700 hover:bg-mint-50 hover:text-teal-700"
                    : "cursor-not-allowed text-ink-400"
                }`}
              >
                <span>{item.label}</span>
                {!item.live && (
                  <span className="ml-2 rounded bg-mint-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-teal-700">
                    soon
                  </span>
                )}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
