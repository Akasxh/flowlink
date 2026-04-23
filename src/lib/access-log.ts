// Minimal access ledger for the agent observability tab.
//
// `log()` writes one row per request. Callers (the withAccessLog wrapper)
// invoke it fire-and-forget so the request path is not blocked by DB latency.
//
// `summary()` aggregates the last `windowSec` seconds for the dashboard:
// top fingerprints, latency percentiles, status mix, total count.
// SQLite has no native percentile_cont, so we pull rows and compute in-process.
// At dashboard refresh cadence (5 s) and small windows (5 min default) the row
// count is bounded — for a window of 5 min @ 100 rps that's 30 k rows, well
// within Node's grasp.

import { prisma } from "./prisma";

export type AccessLogEntry = {
  fingerprint: string;
  route: string;
  method: string;
  status: number;
  latencyMs: number;
  principal?: string | null;
};

export type RouteStat = {
  fingerprint: string;
  route: string;
  method: string;
  p50: number;
  p95: number;
  count: number;
  topStatus: number;
};

export type Summary = {
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

export async function log(entry: AccessLogEntry): Promise<void> {
  try {
    await prisma.agentAccessLog.create({
      data: {
        fingerprint: entry.fingerprint,
        route: entry.route,
        method: entry.method,
        status: entry.status,
        latencyMs: Math.max(0, Math.round(entry.latencyMs)),
        principal: entry.principal ?? null,
      },
    });
  } catch (err) {
    // Observability must never crash the request path. Log to stderr and move on.
    // eslint-disable-next-line no-console
    console.warn("[access-log] write failed:", err instanceof Error ? err.message : err);
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  // Nearest-rank, clamped — fine for dashboard display, no need for linear interpolation.
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, rank));
  return sortedAsc[idx]!;
}

export async function summary(windowSec: number): Promise<Summary> {
  const safeWindow = Math.max(1, Math.min(86_400, Math.floor(windowSec)));
  const since = new Date(Date.now() - safeWindow * 1000);

  const rows = await prisma.agentAccessLog.findMany({
    where: { createdAt: { gte: since } },
    select: {
      fingerprint: true,
      route: true,
      method: true,
      status: true,
      latencyMs: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50_000, // hard cap so a runaway window cannot blow memory
  });

  const totalCount = rows.length;
  const allLat = rows.map((r) => r.latencyMs).sort((a, b) => a - b);

  // Top fingerprints (descending by count)
  const fpCounts = new Map<string, number>();
  for (const r of rows) fpCounts.set(r.fingerprint, (fpCounts.get(r.fingerprint) ?? 0) + 1);
  const topFingerprints = Array.from(fpCounts.entries())
    .map(([fingerprint, count]) => ({ fingerprint, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Status mix
  const statusCounts = new Map<number, number>();
  for (const r of rows) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  const statusBreakdown = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
  const fivexx = rows.reduce((acc, r) => acc + (r.status >= 500 ? 1 : 0), 0);
  const fivexxRate = totalCount === 0 ? 0 : fivexx / totalCount;

  // Per (fingerprint, route, method) bucket
  type Bucket = {
    fingerprint: string;
    route: string;
    method: string;
    lats: number[];
    statusCounts: Map<number, number>;
  };
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const key = `${r.fingerprint}|${r.method}|${r.route}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        fingerprint: r.fingerprint,
        route: r.route,
        method: r.method,
        lats: [],
        statusCounts: new Map<number, number>(),
      };
      buckets.set(key, b);
    }
    b.lats.push(r.latencyMs);
    b.statusCounts.set(r.status, (b.statusCounts.get(r.status) ?? 0) + 1);
  }

  const routes: RouteStat[] = Array.from(buckets.values())
    .map((b) => {
      const sorted = b.lats.slice().sort((a, b2) => a - b2);
      let topStatus = 0;
      let topStatusCount = -1;
      for (const [s, c] of b.statusCounts) {
        if (c > topStatusCount) {
          topStatusCount = c;
          topStatus = s;
        }
      }
      return {
        fingerprint: b.fingerprint,
        route: b.route,
        method: b.method,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        count: b.lats.length,
        topStatus,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  return {
    windowSec: safeWindow,
    totalCount,
    p50: percentile(allLat, 50),
    p95: percentile(allLat, 95),
    fivexxRate,
    topFingerprints,
    statusBreakdown,
    routes,
    generatedAt: new Date().toISOString(),
  };
}
