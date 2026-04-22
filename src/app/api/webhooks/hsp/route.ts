import { NextRequest } from "next/server";
import { verifyWebhookSignature, isConfigured } from "@/lib/hsp";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { ulid } from "@/lib/ulid";
import { prisma } from "@/lib/prisma";
import { signReceipt, storeReceipt } from "@/lib/receipts";

type HspWebhookBody = {
  cart_mandate_id: string;
  payment_request_id?: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  amount: string;
  token: "USDC" | "USDT" | "HSK";
  tx_hash?: string;
  chain_id?: number;
  block?: number;
};

export async function POST(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  try {
    const bodyText = await req.text();

    if (isConfigured()) {
      const timestamp = req.headers.get("x-timestamp") ?? "";
      const nonce = req.headers.get("x-nonce") ?? "";
      const signature = req.headers.get("x-signature") ?? "";
      const valid = verifyWebhookSignature({
        method: "POST",
        path: "/api/webhooks/hsp",
        body: bodyText,
        headers: { timestamp, nonce, signature },
      });
      if (!valid) {
        return problemJson({
          code: "invalid_credentials",
          detail: "hsp webhook signature invalid",
          requestId,
        });
      }
    }

    const body = JSON.parse(bodyText) as HspWebhookBody;

    // Find the transaction by HSP mandate id
    const txn = await prisma.transaction.findFirst({
      where: { hspMandateId: body.cart_mandate_id },
      include: { invoice: true },
    });

    if (!txn) {
      // Unknown mandate — return 200 so HSP doesn't retry forever.
      console.warn("hsp webhook for unknown mandate", body.cart_mandate_id);
      return new Response(JSON.stringify({ ok: true, known: false }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      });
    }

    if (body.status === "SUCCESS") {
      await prisma.transaction.update({
        where: { id: txn.id },
        data: {
          status: "settled",
          txHash: body.tx_hash ?? null,
          block: body.block ?? null,
          settledAt: new Date(),
        },
      });
      if (txn.invoiceId) {
        await prisma.invoice.update({
          where: { id: txn.invoiceId },
          data: { status: "paid", paidAt: new Date() },
        });
      }
      await prisma.transactionEvent.create({
        data: {
          transactionId: txn.id,
          type: "settled",
          data: JSON.stringify({ tx_hash: body.tx_hash, block: body.block }),
        },
      });

      // Sign + store receipt
      try {
        const receiptId = ulid("rcp");
        const signed = await signReceipt({
          receipt_id: receiptId,
          transaction_id: txn.id,
          invoice_id: txn.invoiceId ?? undefined,
          payer_address: txn.payerAddress,
          receiver_address: txn.receiverAddress,
          amount: txn.amount,
          token: txn.token,
          chain_id: txn.chainId,
          tx_hash: body.tx_hash ?? "",
          block: body.block ?? 0,
          settled_at: new Date().toISOString(),
          compliance: {
            ofac: "clear",
            velocity: "within_limits",
            score: txn.complianceScore ?? 100,
          },
        });
        await storeReceipt(signed);
        await prisma.transactionEvent.create({
          data: {
            transactionId: txn.id,
            type: "receipt_ready",
            data: JSON.stringify({ receipt_id: receiptId }),
          },
        });
      } catch (err) {
        console.error("receipt signing failed", err);
        // Settlement happened — receipt failure is logged but not fatal to the webhook.
      }
    } else if (body.status === "FAILED") {
      await prisma.transaction.update({
        where: { id: txn.id },
        data: {
          status: "failed",
          failedAt: new Date(),
          failureCode: "settlement_failed",
        },
      });
      if (txn.invoiceId) {
        await prisma.invoice.update({
          where: { id: txn.invoiceId },
          data: { status: "pending", lockToken: null, lockedAt: null },
        });
      }
      await prisma.transactionEvent.create({
        data: { transactionId: txn.id, type: "failed", data: JSON.stringify({ reason: "hsp_failed" }) },
      });
    }

    return new Response(JSON.stringify({ ok: true, known: true, status: body.status }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
