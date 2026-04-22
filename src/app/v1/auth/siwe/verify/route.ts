import { NextRequest } from "next/server";
import { z } from "zod";
import { verifySiwe } from "@/lib/auth/siwe";
import { signAccessToken } from "@/lib/auth/jwt";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { ulid } from "@/lib/ulid";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, "signature must be 0x-prefixed hex"),
});

const DEFAULT_SCOPES = [
  "invoice:read",
  "invoice:write",
  "pay:execute",
  "receipt:read",
  "compliance:check",
  "reputation:read",
] as const;

const ACCESS_TTL_SEC = 3600;

export async function POST(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return problemJson({
        code: "validation_error",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        instance: "/v1/auth/siwe/verify",
        requestId,
      });
    }

    let verified;
    try {
      verified = await verifySiwe(parsed.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return problemJson({
        code: "invalid_credentials",
        detail: msg,
        instance: "/v1/auth/siwe/verify",
        requestId,
      });
    }

    // Lazy-create user on first SIWE.
    const addr = verified.address;
    const user = await prisma.user.upsert({
      where: { walletAddress: addr },
      create: { walletAddress: addr, displayName: `agent-${addr.slice(2, 8)}` },
      update: {},
    });

    const jti = ulid("jti");
    const token = await signAccessToken({
      subject: user.id,
      scopes: [...DEFAULT_SCOPES],
      authType: "siwe",
      ttlSec: ACCESS_TTL_SEC,
      jti,
    });

    const expiresAt = new Date(Date.now() + ACCESS_TTL_SEC * 1000);
    await prisma.agentToken.create({
      data: {
        userId: user.id,
        jti,
        scopes: DEFAULT_SCOPES.join(","),
        expiresAt,
      },
    });

    return new Response(
      JSON.stringify({
        access_token: token,
        token_type: "Bearer",
        expires_in: ACCESS_TTL_SEC,
        scopes: [...DEFAULT_SCOPES],
        subject: user.id,
        address: addr,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
      },
    );
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
