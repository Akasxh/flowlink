// Admin API for the agent observability tab (/dashboard/agents).
//
// GET /api/admin/observability?window=300 → JSON Summary
//
// Auth: same X-Admin-Token gate as /api/admin/keys. If ADMIN_TOKEN is unset
// the endpoint returns 503 (admin disabled). Replace with NextAuth-style
// sessions in v0.3 alongside the keys route.

import { NextRequest } from "next/server";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { summary } from "@/lib/access-log";

const ROUTE = "/api/admin/observability";
const DEFAULT_WINDOW_SEC = 300;
const MAX_WINDOW_SEC = 86_400;

function checkGate(req: NextRequest, requestId: string): Response | null {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length === 0) {
    return problemJson({
      code: "internal_error",
      detail: "admin disabled (set ADMIN_TOKEN env var to enable /api/admin/*)",
      instance: ROUTE,
      requestId,
    });
  }
  const provided = req.headers.get("x-admin-token");
  if (!provided || provided !== expected) {
    return problemJson({
      code: "auth_required",
      detail: "missing or invalid X-Admin-Token header",
      instance: ROUTE,
      requestId,
    });
  }
  return null;
}

function parseWindowSec(req: NextRequest): number {
  const raw = req.nextUrl.searchParams.get("window");
  if (!raw) return DEFAULT_WINDOW_SEC;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_SEC;
  return Math.min(MAX_WINDOW_SEC, n);
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = getOrMintRequestId(req);
  try {
    const blocked = checkGate(req, requestId);
    if (blocked) return blocked;

    const windowSec = parseWindowSec(req);
    const data = await summary(windowSec);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
