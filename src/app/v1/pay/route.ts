import { NextRequest } from "next/server";
import { z } from "zod";
import { authenticate, hasScope } from "@/lib/auth/middleware";
import { check as complianceCheck } from "@/lib/compliance";
import { createSinglePayMandate, isConfigured as hspConfigured } from "@/lib/hsp";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { ulid } from "@/lib/ulid";
import { ADDRESS_REGEX, isTokenSupported } from "@/lib/chain";
import { prisma } from "@/lib/prisma";
import { canonicalize, lookup as idemLookup, save as idemSave } from "@/lib/idempotency";

const schema = z.object({
  invoice_id: z.string().min(1),
  payer_address: z.string().regex(ADDRESS_REGEX),
  token: z.string().refine(isTokenSupported, "token must be USDC, USDT, or HSK").optional(),
});

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function POST(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  try {
    const principal = await authenticate(req);
    if (!principal) return problemJson({ code: "auth_required", instance: "/v1/pay", requestId });
    if (!hasScope(principal, "pay:execute")) {
      return problemJson({ code: "insufficient_scope", detail: "need pay:execute", requestId });
    }

    const idemKey = req.headers.get("idempotency-key");
    if (!idemKey) {
      return problemJson({ code: "missing_idempotency_key", requestId });
    }

    const rawBody = await req.text();
    const parsed = schema.safeParse(JSON.parse(rawBody || "null"));
    if (!parsed.success) {
      return problemJson({
        code: "validation_error",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        requestId,
      });
    }

    const canonical = canonicalize(parsed.data);
    const idem = await idemLookup({
      principal: principal.id,
      rawKey: idemKey,
      method: "POST",
      path: "/v1/pay",
      body: canonical,
    });
    if (idem.kind === "conflict") return problemJson({ code: "idempotency_conflict", requestId });
    if (idem.kind === "hit") {
      return new Response(JSON.stringify(idem.response), {
        status: idem.statusCode,
        headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true", "X-Request-Id": requestId },
      });
    }

    // Fetch + lock invoice atomically (condition: status = pending)
    const invoice = await prisma.invoice.findUnique({ where: { id: parsed.data.invoice_id } });
    if (!invoice) return problemJson({ code: "invoice_not_found", requestId });
    if (invoice.status === "paid") return problemJson({ code: "invoice_already_paid", requestId });
    if (invoice.status === "expired") return problemJson({ code: "invoice_expired", requestId });
    if (invoice.status !== "pending") {
      return problemJson({
        code: "invoice_not_cancellable", // reusing — status is wrong for pay
        detail: `status is ${invoice.status}`,
        requestId,
      });
    }
    if (invoice.dueAt.getTime() <= Date.now()) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "expired" } });
      return problemJson({ code: "invoice_expired", requestId });
    }

    const token = parsed.data.token ?? invoice.token;

    // Compliance on the PAYER — the payer is the one moving funds
    const compliance = await complianceCheck(parsed.data.payer_address);
    if (!compliance.sanctionsOk && compliance.reason === "sanctions_match") {
      return problemJson({
        code: "compliance_blocked_sanctions",
        detail: compliance.detail ?? "payer flagged",
        requestId,
      });
    }
    if (compliance.reason === "upstream_unavailable") {
      return problemJson({
        code: "compliance_upstream_unavailable",
        detail: compliance.detail,
        requestId,
      });
    }
    if (compliance.reason === "velocity_exceeded") {
      return problemJson({
        code: "compliance_blocked_velocity",
        detail: compliance.detail,
        requestId,
        retryAfter: 3600,
      });
    }

    // DB conditional update — one winner per invoice
    const lockToken = ulid("lock");
    const locked = await prisma.invoice.updateMany({
      where: { id: invoice.id, status: "pending" },
      data: { status: "paying", lockToken, lockedAt: new Date() },
    });
    if (locked.count === 0) {
      return problemJson({
        code: "invoice_already_paid",
        detail: "another agent acquired the payment lock",
        requestId,
      });
    }

    const txnId = ulid("txn");
    const transaction = await prisma.transaction.create({
      data: {
        id: txnId,
        flowlinkId: `flowlink:txn/${txnId}`,
        invoiceId: invoice.id,
        payerAddress: parsed.data.payer_address,
        receiverAddress: invoice.receiverAddress,
        amount: invoice.amount,
        token,
        chainId: invoice.chainId,
        status: "compliance_passed",
        idempotencyKey: idemKey,
        complianceScore: compliance.score,
      },
    });

    await prisma.transactionEvent.create({
      data: {
        transactionId: transaction.id,
        type: "compliance_passed",
        data: JSON.stringify({ score: compliance.score }),
      },
    });

    // Try HSP mandate — graceful degradation if not configured
    let mandate: { cart_mandate_id: string; checkout_url: string; status: string } | null = null;
    if (hspConfigured()) {
      try {
        mandate = await createSinglePayMandate({
          merchantOrderId: invoice.id,
          amount: invoice.amount,
          token: token as "USDC" | "USDT" | "HSK",
          chainId: invoice.chainId,
          webhookUrl: `${APP_URL()}/api/webhooks/hsp`,
          redirectUrl: `${APP_URL()}/pay/invoice/${invoice.id}`,
          description: invoice.purpose ?? `Invoice ${invoice.id}`,
        });
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            status: "mandate_created",
            hspMandateId: mandate.cart_mandate_id,
            checkoutUrl: mandate.checkout_url,
          },
        });
        await prisma.transactionEvent.create({
          data: {
            transactionId: transaction.id,
            type: "mandate_created",
            data: JSON.stringify({ hsp_mandate_id: mandate.cart_mandate_id }),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: "failed", failedAt: new Date(), failureCode: "hsp_upstream_error" },
        });
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: "pending", lockToken: null, lockedAt: null },
        });
        return problemJson({
          code: "hsp_upstream_error",
          detail: msg,
          requestId,
        });
      }
    }

    const response = {
      transaction_id: transaction.id,
      flowlink_id: transaction.flowlinkId,
      status: mandate ? "mandate_created" : "compliance_passed",
      checkout_url: mandate?.checkout_url ?? null,
      hsp_mandate_id: mandate?.cart_mandate_id ?? null,
      hsp_configured: hspConfigured(),
      compliance: {
        score: compliance.score,
        sanctions_ok: compliance.sanctionsOk,
        checked_at: compliance.checkedAt,
      },
      events_url: `/v1/transactions/${transaction.id}/events`,
      expected_settlement_sec: 30,
    };

    await idemSave(idem.keyHash, idem.requestHash, response, 202);

    return new Response(JSON.stringify(response), {
      status: 202,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
