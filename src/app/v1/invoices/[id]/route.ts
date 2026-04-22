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
    if (!hasScope(principal, "invoice:read")) {
      return problemJson({ code: "insufficient_scope", requestId });
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: ctx.params.id } });
    if (!invoice) {
      return problemJson({
        code: "invoice_not_found",
        detail: `no invoice with id=${ctx.params.id}`,
        instance: `/v1/invoices/${ctx.params.id}`,
        requestId,
      });
    }

    return new Response(
      JSON.stringify({
        invoice_id: invoice.id,
        flowlink_id: invoice.flowlinkId,
        status: invoice.status,
        receiver_address: invoice.receiverAddress,
        amount: invoice.amount,
        token: invoice.token,
        chain_id: invoice.chainId,
        purpose: invoice.purpose,
        due_at: invoice.dueAt.toISOString(),
        created_at: invoice.createdAt.toISOString(),
        paid_at: invoice.paidAt?.toISOString() ?? null,
      }),
      { status: 200, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } },
    );
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const requestId = getOrMintRequestId(req);
  try {
    const principal = await authenticate(req);
    if (!principal) return problemJson({ code: "auth_required", requestId });
    if (!hasScope(principal, "invoice:write")) {
      return problemJson({ code: "insufficient_scope", requestId });
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: ctx.params.id } });
    if (!invoice) return problemJson({ code: "invoice_not_found", requestId });
    if (invoice.issuerId !== principal.subject) return problemJson({ code: "not_found", requestId });
    if (invoice.status !== "pending") {
      return problemJson({
        code: "invoice_not_cancellable",
        detail: `status is ${invoice.status}`,
        requestId,
      });
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "cancelled", cancelledAt: new Date() },
    });

    return new Response(null, { status: 204, headers: { "X-Request-Id": requestId } });
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
