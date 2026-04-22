import { NextRequest } from "next/server";
import { z } from "zod";
import { check } from "@/lib/compliance";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { ADDRESS_REGEX } from "@/lib/chain";
import { getRateLimiter, rateLimitHeaders } from "@/lib/ratelimit";

const schema = z.object({
  address: z.string().regex(ADDRESS_REGEX),
});

export async function POST(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  try {
    // Rate limit per IP for anonymous; per-auth-key if auth'd
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
    const rl = await getRateLimiter().check(`compliance:${ip}`, { limit: 60, windowSec: 60 });
    if (!rl.success) {
      return problemJson({
        code: "rate_limited",
        instance: "/v1/compliance/check",
        requestId,
        retryAfter: rl.retryAfter,
        extras: { limit: rl.limit, remaining: rl.remaining },
      });
    }

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return problemJson({
        code: "validation_error",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        instance: "/v1/compliance/check",
        requestId,
      });
    }

    const result = await check(parsed.data.address);

    // Fix (found by round-1 agent enabled-3): 4xx must use Problem+JSON envelope.
    // A 200 answer to a lookup query uses a custom body (the lookup result). But any
    // non-2xx is a contract violation unless it's RFC 9457 Problem+JSON.
    if (result.reason === "upstream_unavailable") {
      return problemJson({
        code: "compliance_upstream_unavailable",
        detail: result.detail ?? "OFAC upstream failed",
        instance: "/v1/compliance/check",
        requestId,
        extras: { address: parsed.data.address },
      });
    }
    if (!result.sanctionsOk && result.reason === "sanctions_match") {
      return problemJson({
        code: "compliance_blocked_sanctions",
        detail: result.detail ?? "address matches OFAC SDN list",
        instance: "/v1/compliance/check",
        requestId,
        extras: {
          address: parsed.data.address,
          score: result.score,
          sanctions_source: result.sanctionsSource,
        },
      });
    }
    if (result.reason === "velocity_exceeded") {
      return problemJson({
        code: "compliance_blocked_velocity",
        detail: result.detail ?? "velocity ceiling exceeded",
        instance: "/v1/compliance/check",
        requestId,
        retryAfter: 3600,
        extras: {
          address: parsed.data.address,
          score: result.score,
          velocity: result.velocity,
        },
      });
    }

    // 200 OK — successful lookup, custom body is appropriate.
    return new Response(
      JSON.stringify({
        address: parsed.data.address,
        sanctions_ok: result.sanctionsOk,
        score: result.score,
        checked_at: result.checkedAt,
        sources: [result.sanctionsSource, "velocity-24h"],
        velocity: {
          window_hours: result.velocity.windowHours,
          total_usd: result.velocity.totalUsd,
          tx_count: result.velocity.txCount,
          limit_usd: result.velocity.limitUsd,
        },
        details: {
          reason: result.reason ?? "clear",
          detail: result.detail,
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
          ...rateLimitHeaders(rl),
        },
      },
    );
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
