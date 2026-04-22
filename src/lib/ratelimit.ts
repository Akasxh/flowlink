// Rate-limiter with a narrow interface and two backends.
//
// Dev: in-memory Map. Works per-instance only; fine for `pnpm dev` but useless under
//      multi-instance Vercel deploys.
// Prod: Upstash Redis (HTTP REST API, no persistent connection needed on serverless).
//
// Backend selection is env-driven at runtime (not at import time — env reads live inside
// the factory function so tests can stub).

type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // unix seconds
  retryAfter?: number; // seconds
};

export type RateLimiter = {
  check(identifier: string, opts: { limit: number; windowSec: number }): Promise<RateLimitResult>;
};

// ── In-memory (dev only) ──────────────────────────────────────────────

type Bucket = { count: number; resetAt: number };
const memStore = new Map<string, Bucket>();

const memoryLimiter: RateLimiter = {
  async check(identifier, { limit, windowSec }) {
    const now = Math.floor(Date.now() / 1000);
    const key = `${identifier}:${windowSec}`;
    let bucket = memStore.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowSec };
      memStore.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    const success = bucket.count <= limit;
    return {
      success,
      limit,
      remaining,
      reset: bucket.resetAt,
      retryAfter: success ? undefined : bucket.resetAt - now,
    };
  },
};

// ── Upstash (prod) ────────────────────────────────────────────────────

type UpstashEnv = { url: string; token: string };

function getUpstashEnv(): UpstashEnv | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

// Sliding-window counter with Upstash INCR + EXPIRE.
// We avoid pulling @upstash/ratelimit as a dep to keep the lib lean — plain REST calls are enough.
function upstashLimiter(env: UpstashEnv): RateLimiter {
  return {
    async check(identifier, { limit, windowSec }) {
      const now = Math.floor(Date.now() / 1000);
      const bucketStart = Math.floor(now / windowSec) * windowSec;
      const key = `ratelimit:${identifier}:${bucketStart}`;
      const resetAt = bucketStart + windowSec;
      try {
        const pipeline = [
          ["INCR", key],
          ["EXPIRE", key, String(windowSec)],
        ];
        const resp = await fetch(`${env.url}/pipeline`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(pipeline),
          // Fail fast — rate limiter should not block the request path.
          signal: AbortSignal.timeout(400),
        });
        if (!resp.ok) throw new Error(`upstash ${resp.status}`);
        const results = (await resp.json()) as Array<{ result: number }>;
        const count = Number(results[0]?.result ?? 0);
        const remaining = Math.max(0, limit - count);
        const success = count <= limit;
        return {
          success,
          limit,
          remaining,
          reset: resetAt,
          retryAfter: success ? undefined : resetAt - now,
        };
      } catch {
        // Fail open on upstream error — rate limits are advisory, not compliance.
        // (Compliance checks fail closed; rate limits fail open.)
        return { success: true, limit, remaining: limit, reset: resetAt };
      }
    },
  };
}

// ── Factory ───────────────────────────────────────────────────────────

export function getRateLimiter(): RateLimiter {
  const upstash = getUpstashEnv();
  if (upstash) return upstashLimiter(upstash);
  return memoryLimiter;
}

// Convenience helper for API routes.
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.reset),
  };
  if (result.retryAfter != null) {
    h["Retry-After"] = String(result.retryAfter);
  }
  return h;
}
