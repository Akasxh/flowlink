// Combined Bearer-token middleware. Accepts two schemes:
//   1. SIWE-issued JWTs (starting with "eyJ")
//   2. API keys (starting with "flk_live_" or "flk_test_")
//
// Returns a `Principal` or null. Route handlers decide what to do on null — usually
// problemJson({ code: "auth_required" }).

import type { ApiKeyScope } from "./apikey";
import { lookupApiKey } from "./apikey";
import type { JwtPayload } from "./jwt";
import { verifyAccessToken } from "./jwt";

export type Principal = {
  id: string;           // stable id (apiKey.id or jwt.jti)
  subject: string;      // userId or wallet address
  authType: "siwe" | "api-key";
  scopes: ApiKeyScope[];
  raw: string;
};

function extractBearer(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1]?.trim() ?? null;
}

export async function authenticate(req: Request): Promise<Principal | null> {
  const token = extractBearer(req);
  if (!token) return null;

  // API key path (prefix-detectable)
  if (token.startsWith("flk_live_") || token.startsWith("flk_test_")) {
    const key = await lookupApiKey(token);
    if (!key) return null;
    return {
      id: key.id,
      subject: key.userId,
      authType: "api-key",
      scopes: key.scopes,
      raw: token,
    };
  }

  // JWT path
  try {
    const payload: JwtPayload = await verifyAccessToken(token);
    return {
      id: payload.jti,
      subject: payload.sub,
      authType: "siwe",
      scopes: payload.scopes as ApiKeyScope[],
      raw: token,
    };
  } catch {
    return null;
  }
}

export function hasScope(principal: Principal, required: ApiKeyScope): boolean {
  return principal.scopes.includes(required);
}
