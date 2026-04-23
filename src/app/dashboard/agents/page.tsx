// Server component shell for /dashboard/agents.
//
// Renders the page chrome and hands the live polling table off to the client
// component (see ObsPanel.tsx). Layout mirrors slide 5 / right panel of
// pitch/v0.2-preview.html: four stat tiles on top, a per-(fingerprint, route)
// table below.

import ObsPanel from "./ObsPanel";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-teal-800">Agents</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-500">
          Live observability for the agent traffic hitting <code className="rounded bg-mint-100 px-1.5 py-0.5 font-mono text-xs text-teal-700">/v1/*</code>.
          Each call carries a stable 12-char fingerprint derived from{" "}
          <code className="rounded bg-mint-100 px-1.5 py-0.5 font-mono text-xs text-teal-700">User-Agent + Accept + Accept-Language</code>{" "}
          — same agent stack from the same machine, same fingerprint. Refreshes every 5s.
        </p>
      </header>

      <ObsPanel />
    </div>
  );
}
