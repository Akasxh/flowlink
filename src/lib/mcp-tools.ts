// MCP tool handlers. Each handler returns the canonical MCP envelope
// `{ content: [{ type: "text", text: <json-stringified result> }], isError? }`
// per spec (https://modelcontextprotocol.io/specification/server/tools).
//
// Handlers call directly into compliance / prisma / chain — NOT into the
// public HTTP routes. This keeps MCP independent of HTTP middleware (rate
// limiting, idempotency, request-id) which would be wrong for the agent
// transport.

import { z } from "zod";
import { ADDRESS_REGEX, isTokenSupported, type TokenSymbol } from "./chain";
import { check as complianceCheck } from "./compliance";
import { prisma } from "./prisma";
import { ulid } from "./ulid";
import { createSinglePayMandate, isConfigured as hspConfigured } from "./hsp";
import {
  generateApiKey,
  revokeApiKey,
  type ApiKeyScope,
} from "./auth/apikey";
import { summary as accessLogSummary } from "./access-log";

export type ToolName =
  | "create_invoice"
  | "get_invoice"
  | "pay_invoice"
  | "check_sanctions"
  | "get_receipt"
  | "get_reputation"
  | "list_api_keys"
  | "mint_api_key"
  | "revoke_api_key"
  | "query_observability";

export type ToolContext = { principalSubject: string };

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

// ── helpers ────────────────────────────────────────────────────────────

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fail(code: string, detail: string, extras?: Record<string, unknown>): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, detail, ...(extras ?? {}) } }) }],
  };
}

function parseArgs<T>(schema: z.ZodSchema<T>, args: unknown): { ok: true; data: T } | { ok: false; detail: string } {
  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true, data: parsed.data };
  const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { ok: false, detail };
}

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const DEFAULT_DUE_DAYS = 30;

// ── create_invoice ─────────────────────────────────────────────────────

const createInvoiceSchema = z.object({
  receiver_address: z.string().regex(ADDRESS_REGEX),
  amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/).refine((v) => Number(v) > 0, "amount must be positive"),
  token: z.string().refine(isTokenSupported, "token must be USDC, USDT, or HSK"),
  purpose: z.string().max(500).optional(),
});

const createInvoice: ToolHandler = async (args, ctx) => {
  const parsed = parseArgs(createInvoiceSchema, args);
  if (!parsed.ok) return fail("validation_error", parsed.detail);

  const compliance = await complianceCheck(parsed.data.receiver_address);
  if (!compliance.sanctionsOk && compliance.reason === "sanctions_match") {
    return fail("compliance_blocked_sanctions", compliance.detail ?? "receiver flagged");
  }
  if (compliance.reason === "upstream_unavailable") {
    return fail("compliance_upstream_unavailable", compliance.detail ?? "OFAC upstream failed");
  }

  const id = ulid("inv");
  const dueAt = new Date(Date.now() + DEFAULT_DUE_DAYS * 24 * 60 * 60 * 1000);
  const invoice = await prisma.invoice.create({
    data: {
      id,
      flowlinkId: `flowlink:inv/${id}`,
      issuerId: ctx.principalSubject,
      receiverAddress: parsed.data.receiver_address,
      amount: parsed.data.amount,
      token: parsed.data.token,
      chainId: 133,
      purpose: parsed.data.purpose ?? null,
      status: "pending",
      dueAt,
    },
  });

  return ok({
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
  });
};

// ── get_invoice ────────────────────────────────────────────────────────

const getInvoiceSchema = z.object({ invoice_id: z.string().min(1) });

const getInvoice: ToolHandler = async (args) => {
  const parsed = parseArgs(getInvoiceSchema, args);
  if (!parsed.ok) return fail("validation_error", parsed.detail);

  const invoice = await prisma.invoice.findUnique({ where: { id: parsed.data.invoice_id } });
  if (!invoice) return fail("invoice_not_found", `no invoice with id=${parsed.data.invoice_id}`);

  return ok({
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
  });
};

// ── pay_invoice ────────────────────────────────────────────────────────

const payInvoiceSchema = z.object({
  invoice_id: z.string().min(1),
  payer_address: z.string().regex(ADDRESS_REGEX),
  token: z.string().refine(isTokenSupported, "token must be USDC, USDT, or HSK").optional(),
});

const payInvoice: ToolHandler = async (args) => {
  const parsed = parseArgs(payInvoiceSchema, args);
  if (!parsed.ok) return fail("validation_error", parsed.detail);

  const invoice = await prisma.invoice.findUnique({ where: { id: parsed.data.invoice_id } });
  if (!invoice) return fail("invoice_not_found", `no invoice with id=${parsed.data.invoice_id}`);
  if (invoice.status === "paid") return fail("invoice_already_paid", "invoice already settled");
  if (invoice.status === "expired") return fail("invoice_expired", "invoice expired");
  if (invoice.status !== "pending") return fail("invoice_not_cancellable", `status is ${invoice.status}`);
  if (invoice.dueAt.getTime() <= Date.now()) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "expired" } });
    return fail("invoice_expired", "invoice past due_at");
  }

  const token = (parsed.data.token ?? invoice.token) as TokenSymbol;

  const compliance = await complianceCheck(parsed.data.payer_address);
  if (!compliance.sanctionsOk && compliance.reason === "sanctions_match") {
    return fail("compliance_blocked_sanctions", compliance.detail ?? "payer flagged");
  }
  if (compliance.reason === "upstream_unavailable") {
    return fail("compliance_upstream_unavailable", compliance.detail ?? "OFAC upstream failed");
  }
  if (compliance.reason === "velocity_exceeded") {
    return fail("compliance_blocked_velocity", compliance.detail ?? "velocity ceiling exceeded", {
      retry_after: 3600,
    });
  }

  // Conditional update — first writer wins
  const lockToken = ulid("lock");
  const locked = await prisma.invoice.updateMany({
    where: { id: invoice.id, status: "pending" },
    data: { status: "paying", lockToken, lockedAt: new Date() },
  });
  if (locked.count === 0) return fail("invoice_already_paid", "another agent acquired the lock");

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

  let mandate: { cart_mandate_id: string; checkout_url: string; status: string } | null = null;
  if (hspConfigured()) {
    try {
      mandate = await createSinglePayMandate({
        merchantOrderId: invoice.id,
        amount: invoice.amount,
        token,
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: "failed", failedAt: new Date(), failureCode: "hsp_upstream_error" },
      });
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "pending", lockToken: null, lockedAt: null },
      });
      return fail("hsp_upstream_error", msg);
    }
  }

  return ok({
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
  });
};

// ── check_sanctions ────────────────────────────────────────────────────

const checkSanctionsSchema = z.object({ address: z.string().regex(ADDRESS_REGEX) });

const checkSanctions: ToolHandler = async (args) => {
  const parsed = parseArgs(checkSanctionsSchema, args);
  if (!parsed.ok) return fail("validation_error", parsed.detail);

  const result = await complianceCheck(parsed.data.address);
  return ok({
    address: parsed.data.address,
    sanctions_ok: result.sanctionsOk,
    score: result.score,
    checked_at: result.checkedAt,
    sources: [result.sanctionsSource, "velocity-24h"],
    velocity: {
      window_hours: result.velocity.windowHours,
      total_usd: result.velocity.totalUsd,
      tx_count: result.velocity.txCount,
      limit_usd: result.velocity.limitUsd,
    },
    reason: result.reason ?? "clear",
    detail: result.detail ?? null,
  });
};

// ── get_receipt ────────────────────────────────────────────────────────

const getReceiptSchema = z
  .object({
    receipt_id: z.string().optional(),
    transaction_id: z.string().optional(),
    invoice_id: z.string().optional(),
  })
  .refine((v) => Boolean(v.receipt_id || v.transaction_id || v.invoice_id), {
    message: "provide one of: receipt_id, transaction_id, invoice_id",
  });

const getReceipt: ToolHandler = async (args) => {
  const parsed = parseArgs(getReceiptSchema, args);
  if (!parsed.ok) return fail("validation_error", parsed.detail);

  let receipt = null;
  if (parsed.data.receipt_id) {
    receipt = await prisma.receipt.findUnique({ where: { id: parsed.data.receipt_id } });
  } else if (parsed.data.transaction_id) {
    receipt = await prisma.receipt.findUnique({ where: { transactionId: parsed.data.transaction_id } });
  } else if (parsed.data.invoice_id) {
    const txn = await prisma.transaction.findFirst({
      where: { invoiceId: parsed.data.invoice_id, status: "settled" },
    });
    if (txn) receipt = await prisma.receipt.findUnique({ where: { transactionId: txn.id } });
  }
  if (!receipt) return fail("receipt_not_found", "no settled receipt for the supplied selector");

  const payload = JSON.parse(receipt.payloadJson) as Record<string, unknown> & { signed_payload_hash?: string };
  return ok({
    ...payload,
    signature: {
      algo: receipt.algo,
      signer: "flowlink.ink",
      key_id: receipt.keyId,
      signed_payload_hash: payload.signed_payload_hash,
      signature: receipt.signature,
      public_key_url: "https://flowlink.ink/.well-known/flowlink-receipt-pubkey.pem",
    },
  });
};

// ── get_reputation ─────────────────────────────────────────────────────

const getReputationSchema = z.object({ address: z.string().regex(ADDRESS_REGEX) });

const getReputation: ToolHandler = async (args) => {
  const parsed = parseArgs(getReputationSchema, args);
  if (!parsed.ok) return fail("validation_error", parsed.detail);

  const addrLower = parsed.data.address.toLowerCase();
  const asPayer = await prisma.transaction.findMany({
    where: { payerAddress: addrLower, status: "settled" },
    select: { amount: true, token: true, createdAt: true },
  });
  const asPayee = await prisma.transaction.findMany({
    where: { receiverAddress: addrLower, status: "settled" },
    select: { amount: true, token: true, createdAt: true },
  });

  const totalTxs = asPayer.length + asPayee.length;
  if (totalTxs === 0) return fail("not_found", "no FlowLink activity for this address");

  const sumUsd = (rows: Array<{ amount: string; token: string }>): number =>
    rows.filter((r) => r.token === "USDC" || r.token === "USDT").reduce((a, r) => a + Number(r.amount), 0);
  const payerVolume = sumUsd(asPayer);
  const payeeVolume = sumUsd(asPayee);
  const volumeUsd = payerVolume + payeeVolume;

  const logSat = (x: number, cap: number): number => Math.min(1, Math.log1p(x) / Math.log1p(cap));
  const score = Math.round(
    (logSat(totalTxs, 200) * 0.25 + logSat(volumeUsd, 100000) * 0.25 + 1 * 0.25 + 1 * 0.25) * 100,
  );

  const all = [...asPayer, ...asPayee];
  const firstSeen = all.map((r) => r.createdAt).sort((a, b) => a.getTime() - b.getTime())[0];
  const lastSeen = all.map((r) => r.createdAt).sort((a, b) => b.getTime() - a.getTime())[0];

  return ok({
    address: parsed.data.address,
    score,
    tx_count: totalTxs,
    volume_usd: volumeUsd,
    on_time_rate: 1.0,
    disputes: 0,
    first_seen: firstSeen?.toISOString() ?? null,
    last_seen: lastSeen?.toISOString() ?? null,
    as_payer: { count: asPayer.length, volume_usd: payerVolume },
    as_payee: { count: asPayee.length, volume_usd: payeeVolume },
    compliance_flags: [],
  });
};

// ── admin tools ────────────────────────────────────────────────────────
//
// These mirror /api/admin/* HTTP routes but call directly into
// `lib/auth/apikey.ts` and `lib/access-log.ts`. Same admin-user pinning
// pattern as the HTTP route (lazy upsert keyed on a deterministic email).
// The MCP transport already authenticates via SIWE bearer; the admin tools
// are flagged `admin: true` in the catalogue so clients (e.g. Claude) can
// surface the dev-only nature in their UI.

const ADMIN_USER_EMAIL = "admin@flowlink.local";
const ALL_API_KEY_SCOPES: readonly ApiKeyScope[] = [
  "invoice:read",
  "invoice:write",
  "pay:execute",
  "receipt:read",
  "compliance:check",
  "reputation:read",
] as const;

async function ensureAdminUserId(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: ADMIN_USER_EMAIL },
    update: {},
    create: { email: ADMIN_USER_EMAIL, displayName: "Local Admin" },
  });
  return user.id;
}

// ── list_api_keys ──────────────────────────────────────────────────────

const listApiKeysSchema = z.object({}).strict();

const listApiKeys: ToolHandler = async (args) => {
  const parsed = parseArgs(listApiKeysSchema, args);
  if (!parsed.ok) return fail("validation_error", parsed.detail);

  const userId = await ensureAdminUserId();
  const rows = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Sanitised projection — never expose `keyHash`. Prefix is safe (already
  // returned by the public mint flow). Caller never recovers the raw key.
  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes.split(",").filter(Boolean) as ApiKeyScope[],
    env: r.prefix.startsWith("flk_live_") ? "live" : "test",
    created_at: r.createdAt.toISOString(),
    last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    revoked_at: r.revokedAt ? r.revokedAt.toISOString() : null,
    expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
  }));

  return ok({ data, count: data.length });
};

// ── mint_api_key ───────────────────────────────────────────────────────

const mintApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(ALL_API_KEY_SCOPES as unknown as [ApiKeyScope, ...ApiKeyScope[]]))
    .min(1),
  env: z.enum(["live", "test"]).optional(),
});

const mintApiKey: ToolHandler = async (args) => {
  const parsed = parseArgs(mintApiKeySchema, args);
  if (!parsed.ok) return fail("validation_error", parsed.detail);

  const userId = await ensureAdminUserId();
  const minted = await generateApiKey({
    userId,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    env: parsed.data.env ?? "test",
  });

  // `rawKey` is shown ONCE — caller (agent) MUST persist it. Server keeps
  // only the sha256 hash, so a lost rawKey forces a fresh mint.
  return ok({
    id: minted.id,
    rawKey: minted.rawKey,
    prefix: minted.prefix,
    scopes: minted.scopes,
    env: parsed.data.env ?? "test",
  });
};

// ── revoke_api_key ─────────────────────────────────────────────────────

const revokeApiKeySchema = z.object({ id: z.string().min(1) });

const revokeApiKeyTool: ToolHandler = async (args) => {
  const parsed = parseArgs(revokeApiKeySchema, args);
  if (!parsed.ok) return fail("validation_error", parsed.detail);

  const userId = await ensureAdminUserId();

  // Defence-in-depth — the admin-user pinning matches the HTTP route, so a
  // misrouted id (e.g. a key owned by a SIWE wallet user) returns 404
  // rather than getting silently revoked.
  const existing = await prisma.apiKey.findUnique({ where: { id: parsed.data.id } });
  if (!existing || existing.userId !== userId) {
    return fail("not_found", "key not found for this admin user");
  }

  await revokeApiKey(parsed.data.id);
  return ok({ id: parsed.data.id, revoked: true });
};

// ── query_observability ────────────────────────────────────────────────

const DEFAULT_OBS_WINDOW_SEC = 300;
const MAX_OBS_WINDOW_SEC = 86_400;

const queryObservabilitySchema = z.object({
  windowSec: z.number().int().positive().max(MAX_OBS_WINDOW_SEC).optional(),
});

const queryObservability: ToolHandler = async (args) => {
  const parsed = parseArgs(queryObservabilitySchema, args);
  if (!parsed.ok) return fail("validation_error", parsed.detail);

  const windowSec = parsed.data.windowSec ?? DEFAULT_OBS_WINDOW_SEC;
  const data = await accessLogSummary(windowSec);
  return ok(data);
};

// ── dispatch table ─────────────────────────────────────────────────────

export const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
  create_invoice: createInvoice,
  get_invoice: getInvoice,
  pay_invoice: payInvoice,
  check_sanctions: checkSanctions,
  get_receipt: getReceipt,
  get_reputation: getReputation,
  list_api_keys: listApiKeys,
  mint_api_key: mintApiKey,
  revoke_api_key: revokeApiKeyTool,
  query_observability: queryObservability,
};
