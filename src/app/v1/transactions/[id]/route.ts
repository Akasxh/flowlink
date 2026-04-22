import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { prisma } from "@/lib/prisma";

type RouteCtx = { params: { id: string } };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const requestId = getOrMintRequestId(req);
  try {
    const principal = await authenticate(req);
    if (!principal) return problemJson({ code: "auth_required", requestId });

    const txn = await prisma.transaction.findUnique({
      where: { id: ctx.params.id },
      include: { events: { orderBy: { createdAt: "asc" } } },
    });
    if (!txn) return problemJson({ code: "transaction_not_found", requestId });

    return new Response(
      JSON.stringify({
        transaction_id: txn.id,
        flowlink_id: txn.flowlinkId,
        invoice_id: txn.invoiceId,
        status: txn.status,
        payer_address: txn.payerAddress,
        receiver_address: txn.receiverAddress,
        amount: txn.amount,
        token: txn.token,
        chain_id: txn.chainId,
        tx_hash: txn.txHash,
        block: txn.block,
        hsp_mandate_id: txn.hspMandateId,
        checkout_url: txn.checkoutUrl,
        compliance_score: txn.complianceScore,
        created_at: txn.createdAt.toISOString(),
        settled_at: txn.settledAt?.toISOString() ?? null,
        failed_at: txn.failedAt?.toISOString() ?? null,
        failure_code: txn.failureCode,
        events: txn.events.map((e) => ({
          type: e.type,
          data: JSON.parse(e.data),
          at: e.createdAt.toISOString(),
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } },
    );
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
