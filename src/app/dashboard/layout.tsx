// Minimal dashboard shell. Sidebar nav matches the v0.2 preview slide:
//   Overview · API keys · Activity · Receipts · Settings
// Only "API keys" is wired in v0.2 — the rest go to placeholder pages.
//
// Agent-discoverability: every dashboard page advertises its agent-readable
// counterpart `/skills/dashboard.md` plus the agent sitemap. The Next 14
// `metadata.alternates.types` API emits `<link rel="alternate" type="…" …>`
// hoisted into the document `<head>`. The matching `Link:` HTTP header is set
// by `src/middleware.ts` so non-HTML clients (curl, fetch w/o DOM) discover
// alternates without parsing markup. The literal `<link rel="describedby">`
// below is rendered into the layout because the Next metadata API has no
// first-class `describedby` field — Next 14 hoists raw `<link>` tags from
// layouts into `<head>` automatically.

import Link from "next/link";
import type { Metadata } from "next";
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

// Override the root layout's `alternates.types` so any page nested under
// `/dashboard/*` points agents at the dashboard skill instead of the
// landing-page agent guide. Nested layouts in Next 14 replace the parent's
// `alternates` shallowly, which is exactly the behavior we want here.
export const metadata: Metadata = {
  alternates: {
    types: {
      "text/markdown": "/skills/dashboard.md",
      "application/json": "/sitemap-agent.json",
    },
  },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-mint-50 text-ink-700">
      {/*
        Agent-readable counterpart and machine-readable sitemap. The two
        `<link rel="alternate">` tags duplicate what the `metadata.alternates`
        export above already emits; we keep them here as a visible, in-source
        contract for the dashboard skill. Next 14 deduplicates identical
        `<link>` tags it hoists into `<head>`. The `describedby` link has no
        equivalent in the Next metadata API, so it lives only here.
      */}
      <link rel="alternate" type="text/markdown" href="/skills/dashboard.md" title="Agent-callable equivalent" />
      <link rel="alternate" type="application/json" href="/sitemap-agent.json" title="Agent sitemap" />
      <link rel="describedby" href="/skills/dashboard.md" />

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
