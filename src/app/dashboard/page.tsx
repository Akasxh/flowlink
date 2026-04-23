// Dashboard overview placeholder. v0.2 only ships /dashboard/keys; this page exists so the
// sidebar nav has a valid root and the layout's "Overview" link doesn't 404.

import Link from "next/link";

export default function DashboardOverview() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-teal-800">Overview</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-500">
          v0.2 ships a single live surface: the API key console. Activity, receipts, and settings
          panels arrive in v0.3 alongside per-user authentication. For now, head to{" "}
          <Link href="/dashboard/keys" className="font-semibold text-teal-700 hover:underline">
            API keys
          </Link>{" "}
          to mint a scoped <code className="rounded bg-mint-100 px-1.5 py-0.5 font-mono text-xs text-teal-700">flk_test_*</code>{" "}
          bearer.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <PlaceholderCard title="Activity" subtitle="Per-route p50/p95, error mix" />
        <PlaceholderCard title="Receipts" subtitle="Ed25519-signed settlements" />
        <PlaceholderCard title="Settings" subtitle="Webhooks, billing, exports" />
      </section>
    </div>
  );
}

function PlaceholderCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-dashed border-mint-200 bg-white p-5">
      <div className="text-sm font-bold text-teal-800">{title}</div>
      <div className="mt-1 text-xs text-ink-500">{subtitle}</div>
      <div className="mt-3 inline-block rounded bg-mint-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-teal-700">
        ships v0.3
      </div>
    </div>
  );
}
