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
import { publish as publishEvent } from "@/lib/event-bus";
import { signReceipt, storeReceipt } from "@/lib/receipts";
import { withAccessLog } from "@/lib/with-access-log";

const schema = z.object({
  invoice_id: z.string().min(1),
  payer_address: z.string().regex(ADDRESS_REGEX),
  token: z.string().refine(isTokenSupported, "token must be USDC, USDT, or HSK").optional(),
});

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

async function postHandler(req: NextRequest) {
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

    const compliancePassedEvent = await prisma.transactionEvent.create({
      data: {
        transactionId: transaction.id,
        type: "compliance_passed",
        data: JSON.stringify({ score: compliance.score }),
      },
    });
    publishEvent(transaction.id, {
      id: compliancePassedEvent.id,
      type: compliancePassedEvent.type,
      data: { score: compliance.score },
      createdAt: compliancePassedEvent.createdAt.toISOString(),
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
        const mandateEvent = await prisma.transactionEvent.create({
          data: {
            transactionId: transaction.id,
            type: "mandate_created",
            data: JSON.stringify({ hsp_mandate_id: mandate.cart_mandate_id }),
          },
        });
        publishEvent(transaction.id, {
          id: mandateEvent.id,
          type: mandateEvent.type,
          data: { hsp_mandate_id: mandate.cart_mandate_id },
          createdAt: mandateEvent.createdAt.toISOString(),
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

    // Dev-mode synthetic settlement — when HSP is not configured (no merchant
    // creds), we still want the agent flow to complete end to end so demos and
    // tests see receipts. tx_hash="0x0" is the sentinel for "no on-chain
    // settlement happened — this is a dev/demo run".
    let devReceiptId: string | null = null;
    let devSettledAt: Date | null = null;
    if (!hspConfigured()) {
      devSettledAt = new Date();
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: "settled",
          txHash: "0x0",
          block: 0,
          settledAt: devSettledAt,
        },
      });
      if (transaction.invoiceId) {
        await prisma.invoice.update({
          where: { id: transaction.invoiceId },
          data: { status: "paid", paidAt: devSettledAt },
        });
      }
      const settledEvent = await prisma.transactionEvent.create({
        data: {
          transactionId: transaction.id,
          type: "settled",
          data: JSON.stringify({ tx_hash: "0x0", block: 0, dev_mode: true }),
        },
      });
      // TODO(merge): event-bus publish for settled
      void settledEvent;

      try {
        const receiptId = ulid("rcp");
        const signed = await signReceipt({
          receipt_id: receiptId,
          transaction_id: transaction.id,
          invoice_id: transaction.invoiceId ?? undefined,
          payer_address: transaction.payerAddress,
          receiver_address: transaction.receiverAddress,
          amount: transaction.amount,
          token: transaction.token,
          chain_id: transaction.chainId,
          tx_hash: "0x0",
          block: 0,
          settled_at: devSettledAt.toISOString(),
          compliance: {
            ofac: "clear",
            velocity: "within_limits",
            score: transaction.complianceScore ?? compliance.score,
          },
        });
        await storeReceipt(signed);
        const receiptEvent = await prisma.transactionEvent.create({
          data: {
            transactionId: transaction.id,
            type: "receipt_ready",
            data: JSON.stringify({ receipt_id: receiptId, dev_mode: true }),
          },
        });
        // TODO(merge): event-bus publish for receipt_ready
        void receiptEvent;
        devReceiptId = receiptId;
      } catch (err) {
        // Receipt failure is logged but not fatal to the dev flow — settlement still happened.
        console.error("dev-mode receipt signing failed", err);
      }
    }

    const response = {
      transaction_id: transaction.id,
      flowlink_id: transaction.flowlinkId,
      status: mandate ? "mandate_created" : devSettledAt ? "settled" : "compliance_passed",
      checkout_url: mandate?.checkout_url ?? null,
      hsp_mandate_id: mandate?.cart_mandate_id ?? null,
      hsp_configured: hspConfigured(),
      receipt_id: devReceiptId,
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

export const POST = withAccessLog(postHandler);
