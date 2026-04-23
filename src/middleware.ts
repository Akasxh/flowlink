// Edge middleware: stamp every human-facing HTML page with a `Link:` HTTP
// header that advertises its agent-readable counterpart. Agents that don't
// parse HTML (curl, fetch loops, scrapers) discover the markdown skill and
// agent sitemap from headers alone — no DOM required.
//
// Two route groups, two header sets:
//   /                  -> point at /llms.txt + /skills (landing-level guide)
//   /dashboard/**      -> point at /skills/dashboard.md + /sitemap-agent.json
//
// The matching `<link rel="alternate">` tags inside the rendered HTML come
// from `src/app/layout.tsx` (root) and `src/app/dashboard/layout.tsx`
// (dashboard). This middleware is the header-only side of the same contract.
//
// Header syntax follows RFC 8288 (Web Linking). Multiple link-values are
// comma-separated; each link-value's parameters are semicolon-separated.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const DASHBOARD_LINK_HEADER = [
  '</skills/dashboard.md>; rel="alternate"; type="text/markdown"; title="Agent-callable equivalent"',
  '</sitemap-agent.json>; rel="alternate"; type="application/json"; title="Agent sitemap"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
].join(", ");

const LANDING_LINK_HEADER = [
  '</llms.txt>; rel="alternate"; type="text/plain"; title="Agent index"',
  '</.well-known/flowlink.md>; rel="alternate"; type="text/markdown"; title="Agent quickstart"',
  '</.well-known/mcp.json>; rel="alternate"; type="application/json"; title="MCP manifest"',
  '</sitemap-agent.json>; rel="alternate"; type="application/json"; title="Agent sitemap"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
].join(", ");

export function middleware(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  // Landing page only (exact match — don't catch /v1, /api, /dashboard…).
  if (pathname === "/") {
    res.headers.set("Link", LANDING_LINK_HEADER);
    return res;
  }

  // Any HTML page under /dashboard. The matcher below already excludes
  // static asset paths, but we double-check the prefix here so future matcher
  // edits can't accidentally stamp `/api/admin/*` JSON responses.
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    res.headers.set("Link", DASHBOARD_LINK_HEADER);
    return res;
  }

  return res;
}

// Restrict the middleware runtime to the two URL families we care about.
// Next.js evaluates the `matcher` at build time, so listing only what we
// need keeps middleware execution cost (and edge runtime cold-start risk)
// to a minimum. The negative-lookahead inside the dashboard matcher excludes
// next-internal asset requests that would otherwise also match.
export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
  ],
};
