import { NextRequest } from "next/server";
import { authenticate, hasScope } from "@/lib/auth/middleware";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { prisma } from "@/lib/prisma";

type RouteCtx = { params: { id: string } };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const requestId = getOrMintRequestId(req);
  try {
    const principal = await authenticate(req);
    if (!principal) return problemJson({ code: "auth_required", requestId });
    if (!hasScope(principal, "receipt:read")) {
      return problemJson({ code: "insufficient_scope", requestId });
    }

    const receipt = await prisma.receipt.findUnique({ where: { id: ctx.params.id } });
    if (!receipt) return problemJson({ code: "receipt_not_found", requestId });

    const payload = JSON.parse(receipt.payloadJson);

    return new Response(
      JSON.stringify({
        ...payload,
        signature: {
          algo: receipt.algo,
          signer: "flowlink.ink",
          key_id: receipt.keyId,
          signed_payload_hash: payload.signed_payload_hash,
          signature: receipt.signature,
          public_key_url: "https://flowlink.ink/.well-known/flowlink-receipt-pubkey.pem",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } },
    );
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
