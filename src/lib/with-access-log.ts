// Wrapper: withAccessLog(handler) — drop-in for any Next.js App Router handler.
//
// Computes a stable agent fingerprint, times the inner handler, and writes one
// AgentAccessLog row fire-and-forget so the request path is unblocked.
//
// Principal extraction is best-effort: we only parse the bearer token if it
// looks like an API key (cheap prefix check). Decoding a JWT here would mean
// pulling in the verifier and an extra DB lookup, which defeats the
// "non-blocking" promise. The dashboard treats `principal` as advisory.

import { fingerprint as computeFingerprint } from "./agent-fingerprint";
import { log as writeLog } from "./access-log";

// Loose handler type. Accepts any subtype of Request (including NextRequest)
// and any context shape Next.js passes for dynamic segments. Generics carry
// the original signature through so the wrapped export keeps its types.
type RouteHandler<Req extends Request = Request, Ctx = unknown> = (
  req: Req,
  ctx: Ctx,
) => Promise<Response> | Response;

function inferPrincipal(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const token = m?.[1]?.trim();
  if (!token) return null;
  if (token.startsWith("flk_live_") || token.startsWith("flk_test_")) {
    // Identify the key by its prefix only — never persist the secret.
    return `apikey:${token.slice(0, 16)}`;
  }
  if (token.startsWith("eyJ")) {
    return "siwe:jwt"; // opaque marker; decoding here would block the path
  }
  return null;
}

function inferRoute(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "unknown";
  }
}

export function withAccessLog<Req extends Request, Ctx>(
  handler: RouteHandler<Req, Ctx>,
): RouteHandler<Req, Ctx> {
  return async (req: Req, ctx: Ctx): Promise<Response> => {
    const start = Date.now();
    const fp = computeFingerprint(req);
    const route = inferRoute(req);
    const principal = inferPrincipal(req);

    let status = 500;
    try {
      const res = await handler(req, ctx);
      status = res.status;
      return res;
    } catch (err) {
      // Re-throw — Next.js will turn this into a 500. We still log it.
      throw err;
    } finally {
      const latencyMs = Date.now() - start;
      // Fire-and-forget. Catch any rejection so it never becomes
      // an unhandled promise.
      void writeLog({
        fingerprint: fp,
        route,
        method: req.method,
        status,
        latencyMs,
        principal,
      }).catch(() => {
        /* already logged inside writeLog */
      });
    }
  };
}
