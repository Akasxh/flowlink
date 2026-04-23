"use client";

// Live observability panel. Polls /api/admin/observability every 5s with the
// same X-Admin-Token (in localStorage) used by /dashboard/keys.
//
// Visual model mirrors slide 5 / right panel of pitch/v0.2-preview.html:
//   ┌─────────────┬──────────────┐
//   │  Calls 5m   │  P95 latency │
//   ├─────────────┼──────────────┤
//   │  Top fp     │  5xx rate    │
//   └─────────────┴──────────────┘
//   ┌──────────────────────────────────────────────┐
//   │  fingerprint │ route │ p50 │ status │ n     │
//   └──────────────────────────────────────────────┘

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RouteStat = {
  fingerprint: string;
  route: string;
  method: string;
  p50: number;
  p95: number;
  count: number;
  topStatus: number;
};

type Summary = {
  windowSec: number;
  totalCount: number;
  p50: number;
  p95: number;
  fivexxRate: number;
  topFingerprints: Array<{ fingerprint: string; count: number }>;
  statusBreakdown: Array<{ status: number; count: number }>;
  routes: RouteStat[];
  generatedAt: string;
};

const TOKEN_KEY = "flowlink.admin.token";
const POLL_MS = 5_000;
const DEFAULT_WINDOW_SEC = 300;
const LATENCY_BUDGET_MS = 500;

function fmtInt(n: number): string {
  return n.toLocaleString();
}

function fmtMs(n: number): string {
  return `${Math.round(n)} ms`;
}

function fmtPct(rate: number): string {
  if (rate === 0) return "0.00%";
  if (rate < 0.0001) return "<0.01%";
  return `${(rate * 100).toFixed(2)}%`;
}

function statusClass(status: number): string {
  if (status >= 500) return "bg-red-100 text-red-700";
  if (status >= 400) return "bg-amber-100 text-amber-700";
  if (status >= 300) return "bg-mint-100 text-teal-700";
  if (status >= 200) return "bg-mint-100 text-green-600";
  return "bg-mint-100 text-ink-500";
}

export default function ObsPanel() {
  const [token, setToken] = useState<string>("");
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
    if (stored) setToken(stored);
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const fetchOnce = useCallback(async (): Promise<void> => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/observability?window=${DEFAULT_WINDOW_SEC}`, {
        headers: { "X-Admin-Token": token },
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
      }
      const json = (await res.json()) as Summary;
      if (!aliveRef.current) return;
      setData(json);
      setError(null);
      setLastFetched(new Date());
    } catch (e) {
      if (!aliveRef.current) return;
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void fetchOnce();
    const id = window.setInterval(() => {
      void fetchOnce();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [token, fetchOnce]);

  const saveToken = (next: string) => {
    setToken(next);
    if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, next);
  };

  const topFp = useMemo(() => data?.topFingerprints[0]?.fingerprint ?? "—", [data]);
  const p95Color =
    data && data.p95 > LATENCY_BUDGET_MS ? "text-red-700" : "text-teal-800";
  const fivexxColor =
    data && data.fivexxRate > 0.01 ? "text-red-700" : "text-green-600";

  return (
    <div className="space-y-5">
      {/* Admin token gate */}
      {!token && (
        <div className="rounded-xl border border-dashed border-mint-200 bg-white p-5 text-sm">
          <div className="font-bold text-teal-800">Admin token required</div>
          <p className="mt-1 text-ink-500">
            Paste your <code className="rounded bg-mint-100 px-1.5 py-0.5 font-mono text-xs text-teal-700">ADMIN_TOKEN</code>{" "}
            below — it&apos;s saved to <code>localStorage</code> and reused by /dashboard/keys.
          </p>
          <input
            type="password"
            placeholder="ADMIN_TOKEN"
            className="mt-3 w-full rounded-md border border-mint-200 px-3 py-2 font-mono text-sm focus:border-teal-500 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) saveToken(v);
              }
            }}
          />
        </div>
      )}

      {token && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-bold">Polling error</div>
          <code className="mt-1 block break-all font-mono text-xs">{error}</code>
          <button
            type="button"
            onClick={() => saveToken("")}
            className="mt-2 rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
          >
            Reset token
          </button>
        </div>
      )}

      {/* Stat tiles */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Calls 5m"
          value={data ? fmtInt(data.totalCount) : "—"}
          sub={data ? `window: ${data.windowSec}s` : "loading…"}
        />
        <StatTile
          label="P95 latency"
          value={data ? fmtMs(data.p95) : "—"}
          sub={`budget: ${LATENCY_BUDGET_MS} ms`}
          valueClassName={p95Color}
        />
        <StatTile
          label="Top fingerprint"
          value={topFp}
          sub={data && data.topFingerprints[0] ? `${fmtInt(data.topFingerprints[0].count)} calls` : "—"}
          valueClassName="font-mono text-base text-teal-700"
        />
        <StatTile
          label="5xx rate"
          value={data ? fmtPct(data.fivexxRate) : "—"}
          sub={data ? `p50 ${fmtMs(data.p50)}` : ""}
          valueClassName={fivexxColor}
        />
      </section>

      {/* Per-route table */}
      <section className="rounded-xl border border-mint-200 bg-white">
        <div className="grid grid-cols-[120px_1fr_70px_70px_70px] gap-3 border-b border-mint-100 bg-mint-50 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-500">
          <div>Fingerprint</div>
          <div>Route</div>
          <div className="text-right">p50</div>
          <div className="text-center">Status</div>
          <div className="text-right">n</div>
        </div>
        {data && data.routes.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-ink-400">
            No requests in the last {data.windowSec}s. Hit any wrapped route to populate.
          </div>
        )}
        {data?.routes.map((r) => (
          <div
            key={`${r.fingerprint}-${r.method}-${r.route}`}
            className="grid grid-cols-[120px_1fr_70px_70px_70px] items-center gap-3 border-b border-mint-100 px-4 py-2.5 font-mono text-xs"
          >
            <div className="font-bold text-teal-700">{r.fingerprint}</div>
            <div className="truncate text-ink-700">
              <span className="mr-1 text-ink-400">{r.method}</span>
              {r.route}
            </div>
            <div className="text-right text-ink-500">{Math.round(r.p50)}ms</div>
            <div className="text-center">
              <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${statusClass(r.topStatus)}`}>
                {r.topStatus}
              </span>
            </div>
            <div className="text-right text-ink-500">{fmtInt(r.count)}</div>
          </div>
        ))}
      </section>

      {/* Footer status */}
      <div className="flex items-center justify-between text-xs text-ink-400">
        <span>
          {loading ? "Refreshing…" : lastFetched ? `Last poll: ${lastFetched.toLocaleTimeString()}` : "Idle"}
        </span>
        <span>
          Generated <code className="font-mono">{data?.generatedAt ?? "—"}</code>
        </span>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-mint-200 bg-white p-4">
      <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink-400">
        {label}
      </span>
      <span className={`text-2xl font-extrabold tabular-nums text-teal-800 ${valueClassName ?? ""}`}>
        {value}
      </span>
      <span className="text-xs text-ink-500">{sub}</span>
    </div>
  );
}
