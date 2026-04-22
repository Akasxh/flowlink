// Compliance module — OFAC screening + 24h velocity check.
//
// CRITICAL: fails closed. If the OFAC upstream is unreachable, `check()` returns
// a result that /v1/pay interprets as "block the call". This is intentional — a
// compliance system that silently passes under network partition is not compliance.
//
// Data sources (in priority order):
//   1. Fallback list (embedded below — known-bad addresses, never depends on network)
//   2. api.ofac.dev live check (fails closed on error)
//   3. Prisma-backed velocity ledger (24h rolling window on ComplianceLog)

import { prisma } from "./prisma";

// Known-bad addresses — checked before any network call. Sourced from:
//   - OFAC SDN list (Tornado Cash sanctions)
//   - DPRK/Lazarus attributions (public)
//   - Common scam/drainer addresses
// This list is deliberately short and stable. The live OFAC check supplements it.
const FALLBACK_SANCTIONED = new Set<string>(
  [
    // Tornado Cash contracts (OFAC SDN 2022-08-08)
    "0x8589427373d6d84e98730d7795d8f6f8731fda16",
    "0x722122df12d4e14e13ac3b6895a86e84145b6967",
    "0xdd4c48c0b24039969fc16d1cdf626eab821d3384",
    "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b",
    "0xd96f2b1c14db8458374d9aca76e26c3d18364307",
    "0x4736dcf1b7a3d580672ccce6213ca176d69c8b8c",
    "0xd691f27f38b395864ea86cfc7253969b409c362d",
    "0x178169b423a011fff22b9e3f3abea13414ddd0f1",
    "0x610b717796ad172b316836ac95a2ffad065ceab4",
    "0xbb93e510bbcd0b7beb5a853875f9ec60275cf498",
    "0xa0e1c89ef1a489c9c7de96311ed5ce5d32c20e4b",
    "0x23773e65ed146a459791799d01336db287f25334",
    "0x58e8dcc13be9780fc42e8723d8ead4cf46943df2",
    // Lazarus-attributed wallets (examples — expand from Chainalysis OFAC feed)
    "0x098b716b8aaf21512996dc57eb0615e2383e2f96",
  ].map((a) => a.toLowerCase()),
);

export type ComplianceResult = {
  ok: boolean;
  score: number;
  sanctionsOk: boolean;
  sanctionsSource: "fallback" | "ofac-api" | "cache";
  velocity: {
    windowHours: number;
    totalUsd: number;
    txCount: number;
    limitUsd: number;
    ok: boolean;
  };
  reason?: "sanctions_match" | "velocity_exceeded" | "upstream_unavailable";
  detail?: string;
  checkedAt: string;
};

const OFAC_API_URL = () => process.env.OFAC_API_URL ?? "https://api.ofac.dev/v1/ethereum";
const MIN_SCORE = () => Number(process.env.COMPLIANCE_MIN_SCORE ?? "60");
const VELOCITY_LIMIT_USD = () => Number(process.env.VELOCITY_LIMIT_USD ?? "10000");
const CACHE_TTL_MS = 60 * 1000;
const OFAC_TIMEOUT_MS = 2500;

type CacheEntry = { result: ComplianceResult; at: number };
const cache = new Map<string, CacheEntry>();

export async function check(address: string): Promise<ComplianceResult> {
  const norm = address.toLowerCase();

  // Fast path: in-memory cache
  const cached = cache.get(norm);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.result, sanctionsSource: "cache" as const };
  }

  // Step 1: fallback list (network-free)
  if (FALLBACK_SANCTIONED.has(norm)) {
    return finalize(address, {
      sanctionsOk: false,
      sanctionsSource: "fallback",
      reason: "sanctions_match",
      detail: "address matches embedded OFAC fallback list",
    });
  }

  // Step 2: OFAC live check (FAIL CLOSED on any error)
  let sanctionsOk: boolean;
  let ofacDetail: string | undefined;
  try {
    const resp = await fetch(`${OFAC_API_URL()}/${address}`, {
      signal: AbortSignal.timeout(OFAC_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`ofac upstream ${resp.status}`);
    const body = (await resp.json()) as { sanctioned?: boolean; list?: string[] };
    sanctionsOk = body.sanctioned !== true;
    ofacDetail = body.list?.join(",");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return finalize(address, {
      sanctionsOk: false,
      sanctionsSource: "ofac-api",
      reason: "upstream_unavailable",
      detail: `OFAC check failed (fail-closed): ${msg}`,
    });
  }

  if (!sanctionsOk) {
    return finalize(address, {
      sanctionsOk: false,
      sanctionsSource: "ofac-api",
      reason: "sanctions_match",
      detail: ofacDetail ?? "OFAC SDN match",
    });
  }

  // Step 3: velocity check (Prisma ledger)
  const velocity = await velocityCheck(address);

  return finalize(address, {
    sanctionsOk: true,
    sanctionsSource: "ofac-api",
    velocity,
    reason: velocity.ok ? undefined : "velocity_exceeded",
    detail: velocity.ok ? undefined : `24h volume ${velocity.totalUsd} USD exceeds ${velocity.limitUsd} USD`,
  });
}

async function velocityCheck(address: string): Promise<ComplianceResult["velocity"]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Note: in a real deploy the velocity source is the Transaction table joined to
  // current spot prices. For v1 we use the ComplianceLog as a proxy — each /v1/pay
  // call writes a log entry; velocity = sum of amounts in last 24h.
  // This is intentionally conservative (over-counts if two routes screen same address).
  const logs = await prisma.complianceLog.findMany({
    where: { address: address.toLowerCase(), createdAt: { gte: since } },
    select: { detail: true },
  });
  let totalUsd = 0;
  for (const log of logs) {
    if (!log.detail) continue;
    try {
      const parsed = JSON.parse(log.detail) as { amount_usd?: number };
      if (typeof parsed.amount_usd === "number") totalUsd += parsed.amount_usd;
    } catch {
      // ignore malformed rows
    }
  }
  const limit = VELOCITY_LIMIT_USD();
  return {
    windowHours: 24,
    totalUsd,
    txCount: logs.length,
    limitUsd: limit,
    ok: totalUsd <= limit,
  };
}

function finalize(
  address: string,
  partial: Partial<ComplianceResult> & {
    sanctionsOk: boolean;
    sanctionsSource: "fallback" | "ofac-api";
    reason?: ComplianceResult["reason"];
    detail?: string;
    velocity?: ComplianceResult["velocity"];
  },
): ComplianceResult {
  const velocity: ComplianceResult["velocity"] = partial.velocity ?? {
    windowHours: 24,
    totalUsd: 0,
    txCount: 0,
    limitUsd: VELOCITY_LIMIT_USD(),
    ok: true,
  };
  let score = 100;
  if (!partial.sanctionsOk) score = 0;
  else if (!velocity.ok) score = 30;
  const ok = score >= MIN_SCORE();
  const result: ComplianceResult = {
    ok,
    score,
    sanctionsOk: partial.sanctionsOk,
    sanctionsSource: partial.sanctionsSource,
    velocity,
    reason: partial.reason,
    detail: partial.detail,
    checkedAt: new Date().toISOString(),
  };
  // Cache positive results briefly; negative results are also cached to dampen hot loops
  cache.set(address.toLowerCase(), { result, at: Date.now() });
  // Fire-and-forget audit log
  void prisma.complianceLog
    .create({
      data: {
        address: address.toLowerCase(),
        sanctionsOk: partial.sanctionsOk,
        score,
        source: partial.sanctionsSource,
        detail: partial.detail ? JSON.stringify({ reason: partial.reason, detail: partial.detail }) : null,
      },
    })
    .catch(() => {
      /* ledger write failures shouldn't block caller */
    });
  return result;
}
