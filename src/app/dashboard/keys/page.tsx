// Server component shell for /dashboard/keys.
// Renders the page chrome (header + lede) and hands the interactive table off to a client
// component. We intentionally do NOT pre-fetch keys server-side: the admin token only lives in
// the browser's localStorage in v0.2 (no per-user session yet), so the client owns auth.

import KeysTable from "./KeysTable";

export const dynamic = "force-dynamic";

export default function KeysPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-teal-800">API keys</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-500">
          Scoped bearer tokens for non-wallet agent integrations. Test keys never settle real
          money. Live keys can. The raw key is shown <strong className="text-ink-700">exactly once</strong>{" "}
          at mint time and stored as a SHA-256 hash thereafter.
        </p>
      </header>

      <KeysTable />
    </div>
  );
}
