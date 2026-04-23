// Admin API for the in-app /dashboard/keys UI.
//
// NOTE: this is /api/admin/* — UI helper, not part of the agent-facing /v1/* surface.
// v0.2 auth: a single shared header `X-Admin-Token` matched against process.env.ADMIN_TOKEN.
// If ADMIN_TOKEN is unset, the endpoint returns 503 ("admin disabled"). Replace with
// real per-user NextAuth-style sessions in v0.3.
//
// Endpoints:
//   GET    /api/admin/keys           → list keys for the admin user
//   POST   /api/admin/keys           → mint { name, scopes, env? } → returns rawKey ONCE
//   DELETE /api/admin/keys           → revoke { id }
//
// Each key belongs to a deterministic local "admin" User row (lazily created on first call).
// That keeps the schema honest (ApiKey requires a userId) without dragging in user-management UI.

import { NextRequest } from "next/server";
import { z } from "zod";
import { generateApiKey, revokeApiKey, type ApiKeyScope } from "@/lib/auth/apikey";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getOrMintRequestId } from "@/lib/request-id";

const ALL_SCOPES: readonly ApiKeyScope[] = [
  "invoice:read",
  "invoice:write",
  "pay:execute",
  "receipt:read",
  "compliance:check",
  "reputation:read",
] as const;

const ADMIN_USER_EMAIL = "admin@flowlink.local";

const mintSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(ALL_SCOPES as unknown as [ApiKeyScope, ...ApiKeyScope[]])).min(1),
  env: z.enum(["live", "test"]).optional(),
});

const revokeSchema = z.object({
  id: z.string().min(1),
});

type AdminGate = { ok: true; userId: string } | { ok: false; response: Response };

async function gate(req: NextRequest, requestId: string): Promise<AdminGate> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length === 0) {
    return {
      ok: false,
      response: problemJson({
        code: "internal_error",
        detail: "admin disabled (set ADMIN_TOKEN env var to enable /api/admin/*)",
        instance: "/api/admin/keys",
        requestId,
      }),
    };
  }
  const provided = req.headers.get("x-admin-token");
  if (!provided || provided !== expected) {
    return {
      ok: false,
      response: problemJson({
        code: "auth_required",
        detail: "missing or invalid X-Admin-Token header",
        instance: "/api/admin/keys",
        requestId,
      }),
    };
  }
  // Lazily ensure the admin user row exists. We pin to email so this stays stable across runs.
  const user = await prisma.user.upsert({
    where: { email: ADMIN_USER_EMAIL },
    update: {},
    create: { email: ADMIN_USER_EMAIL, displayName: "Local Admin" },
  });
  return { ok: true, userId: user.id };
}

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = getOrMintRequestId(req);
  try {
    const g = await gate(req, requestId);
    if (!g.ok) return g.response;

    const rows = await prisma.apiKey.findMany({
      where: { userId: g.userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes.split(",").filter(Boolean) as ApiKeyScope[],
      env: r.prefix.startsWith("flk_live_") ? "live" : "test",
      created_at: r.createdAt.toISOString(),
      last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      revoked_at: r.revokedAt ? r.revokedAt.toISOString() : null,
      expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
    }));

    return jsonResponse({ data, count: data.length }, 200, requestId);
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = getOrMintRequestId(req);
  try {
    const g = await gate(req, requestId);
    if (!g.ok) return g.response;

    const raw = await req.text();
    const parsed = mintSchema.safeParse(raw.length > 0 ? JSON.parse(raw) : null);
    if (!parsed.success) {
      return problemJson({
        code: "validation_error",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        instance: "/api/admin/keys",
        requestId,
      });
    }

    const minted = await generateApiKey({
      userId: g.userId,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      env: parsed.data.env ?? "test",
    });

    return jsonResponse(
      {
        id: minted.id,
        rawKey: minted.rawKey,
        prefix: minted.prefix,
        scopes: minted.scopes,
        env: parsed.data.env ?? "test",
      },
      201,
      requestId,
    );
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const requestId = getOrMintRequestId(req);
  try {
    const g = await gate(req, requestId);
    if (!g.ok) return g.response;

    const raw = await req.text();
    const parsed = revokeSchema.safeParse(raw.length > 0 ? JSON.parse(raw) : null);
    if (!parsed.success) {
      return problemJson({
        code: "validation_error",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        instance: "/api/admin/keys",
        requestId,
      });
    }

    // Confirm the key belongs to the admin user before revoking — defence-in-depth so a stolen
    // ADMIN_TOKEN can't pivot to revoke unrelated keys created out-of-band.
    const existing = await prisma.apiKey.findUnique({ where: { id: parsed.data.id } });
    if (!existing || existing.userId !== g.userId) {
      return problemJson({
        code: "not_found",
        detail: "key not found for this admin user",
        instance: "/api/admin/keys",
        requestId,
      });
    }

    await revokeApiKey(parsed.data.id);
    return jsonResponse({ id: parsed.data.id, revoked: true }, 200, requestId);
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
