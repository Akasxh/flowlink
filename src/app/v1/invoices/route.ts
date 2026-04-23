import { NextRequest } from "next/server";
import { z } from "zod";
import { authenticate, hasScope } from "@/lib/auth/middleware";
import { check as complianceCheck } from "@/lib/compliance";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { ulid } from "@/lib/ulid";
import { ADDRESS_REGEX, isTokenSupported } from "@/lib/chain";
import { prisma } from "@/lib/prisma";
import { canonicalize, lookup as idemLookup, save as idemSave } from "@/lib/idempotency";
import { withAccessLog } from "@/lib/with-access-log";

const createSchema = z.object({
  receiver_address: z.string().regex(ADDRESS_REGEX),
  amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/).refine((v) => Number(v) > 0, "amount must be positive"),
  token: z.string().refine(isTokenSupported, "token must be USDC, USDT, or HSK"),
  purpose: z.string().max(500).optional(),
  due_at: z.string().datetime().optional(),
});

const DEFAULT_DUE_DAYS = 30;

async function postHandler(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  try {
    const principal = await authenticate(req);
    if (!principal) {
      return problemJson({ code: "auth_required", instance: "/v1/invoices", requestId });
    }
    if (!hasScope(principal, "invoice:write")) {
      return problemJson({ code: "insufficient_scope", detail: "need invoice:write", instance: "/v1/invoices", requestId });
    }

    const idemKey = req.headers.get("idempotency-key");
    if (!idemKey) {
      return problemJson({ code: "missing_idempotency_key", instance: "/v1/invoices", requestId });
    }

    const rawBody = await req.text();
    const parsed = createSchema.safeParse(JSON.parse(rawBody || "null"));
    if (!parsed.success) {
      return problemJson({
        code: "validation_error",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        instance: "/v1/invoices",
        requestId,
      });
    }

    const canonical = canonicalize(parsed.data);
    const idem = await idemLookup({
      principal: principal.id,
      rawKey: idemKey,
      method: "POST",
      path: "/v1/invoices",
      body: canonical,
    });
    if (idem.kind === "conflict") {
      return problemJson({ code: "idempotency_conflict", instance: "/v1/invoices", requestId });
    }
    if (idem.kind === "hit") {
      return new Response(JSON.stringify(idem.response), {
        status: idem.statusCode,
        headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true", "X-Request-Id": requestId },
      });
    }

    // Compliance preflight on receiver
    const compliance = await complianceCheck(parsed.data.receiver_address);
    if (!compliance.sanctionsOk && compliance.reason === "sanctions_match") {
      return problemJson({
        code: "compliance_blocked_sanctions",
        detail: compliance.detail ?? "receiver flagged",
        instance: "/v1/invoices",
        requestId,
      });
    }
    if (compliance.reason === "upstream_unavailable") {
      return problemJson({
        code: "compliance_upstream_unavailable",
        detail: compliance.detail,
        instance: "/v1/invoices",
        requestId,
      });
    }

    const id = ulid("inv");
    const flowlinkId = `flowlink:inv/${id}`;
    const dueAt = parsed.data.due_at
      ? new Date(parsed.data.due_at)
      : new Date(Date.now() + DEFAULT_DUE_DAYS * 24 * 60 * 60 * 1000);

    if (dueAt.getTime() <= Date.now()) {
      return problemJson({
        code: "validation_error",
        detail: "due_at must be in the future",
        instance: "/v1/invoices",
        requestId,
      });
    }

    const invoice = await prisma.invoice.create({
      data: {
        id,
        flowlinkId,
        issuerId: principal.subject,
        receiverAddress: parsed.data.receiver_address,
        amount: parsed.data.amount,
        token: parsed.data.token,
        chainId: 133,
        purpose: parsed.data.purpose ?? null,
        status: "pending",
        dueAt,
      },
    });

    const response = {
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
    };

    await idemSave(idem.keyHash, idem.requestHash, response, 201);

    return new Response(JSON.stringify(response), {
      status: 201,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}

async function getHandler(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  try {
    const principal = await authenticate(req);
    if (!principal) return problemJson({ code: "auth_required", instance: "/v1/invoices", requestId });
    if (!hasScope(principal, "invoice:read")) {
      return problemJson({ code: "insufficient_scope", detail: "need invoice:read", instance: "/v1/invoices", requestId });
    }

    const invoices = await prisma.invoice.findMany({
      where: { issuerId: principal.subject },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return new Response(
      JSON.stringify({
        data: invoices.map((i) => ({
          invoice_id: i.id,
          flowlink_id: i.flowlinkId,
          status: i.status,
          receiver_address: i.receiverAddress,
          amount: i.amount,
          token: i.token,
          chain_id: i.chainId,
          due_at: i.dueAt.toISOString(),
          created_at: i.createdAt.toISOString(),
        })),
        count: invoices.length,
      }),
      { status: 200, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } },
    );
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}

export const POST = withAccessLog(postHandler);
export const GET = withAccessLog(getHandler);
