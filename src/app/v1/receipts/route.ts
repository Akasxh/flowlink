import { NextRequest } from "next/server";
import { authenticate, hasScope } from "@/lib/auth/middleware";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { prisma } from "@/lib/prisma";

// Lookup a receipt by invoice_id or transaction_id.

export async function GET(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  try {
    const principal = await authenticate(req);
    if (!principal) return problemJson({ code: "auth_required", requestId });
    if (!hasScope(principal, "receipt:read")) {
      return problemJson({ code: "insufficient_scope", requestId });
    }

    const url = new URL(req.url);
    const invoiceId = url.searchParams.get("invoice_id");
    const transactionId = url.searchParams.get("transaction_id");

    if (!invoiceId && !transactionId) {
      return problemJson({
        code: "validation_error",
        detail: "provide invoice_id or transaction_id",
        requestId,
      });
    }

    let receipt = null;
    if (transactionId) {
      receipt = await prisma.receipt.findUnique({ where: { transactionId } });
    } else if (invoiceId) {
      const txn = await prisma.transaction.findFirst({ where: { invoiceId, status: "settled" } });
      if (txn) receipt = await prisma.receipt.findUnique({ where: { transactionId: txn.id } });
    }

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
