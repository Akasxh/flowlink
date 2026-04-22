import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { problemJson } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";

export async function GET(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  const principal = await authenticate(req);
  if (!principal) {
    return problemJson({
      code: "auth_required",
      instance: "/v1/auth/whoami",
      requestId,
    });
  }
  return new Response(
    JSON.stringify({
      subject: principal.subject,
      auth_type: principal.authType,
      scopes: principal.scopes,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
    },
  );
}
