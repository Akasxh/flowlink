// Canonical Zod schemas for FlowLink v1 endpoints.
//
// These mirror the inline `z.object(...)` definitions in each route handler
// so the OpenAPI generator (src/lib/openapi.ts) can describe the public
// contract from the same source the routes validate against. Routes are NOT
// required to import these — they only exist to give the generator a single
// authoritative shape per request/response. Keep these in sync with the
// route files when fields change.
//
// Naming: lowerCamel for variables, PascalCase for the OpenAPI component
// names registered in src/lib/openapi.ts.
//
// Conventions:
//  - Addresses are 0x + 40 hex (EIP-55 checksum validated elsewhere).
//  - Amounts are decimal strings (avoid float drift in transit).
//  - Tokens are restricted to USDC | USDT | HSK (see src/lib/chain.ts).
//  - All timestamps are ISO-8601 strings.

import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { ADDRESS_REGEX } from "@/lib/chain";

// Patch Zod with `.openapi(...)` here — this module is imported by
// src/lib/openapi.ts and may also be imported standalone by routes that
// want canonical schemas, so the patch must happen at the schema source.
extendZodWithOpenApi(z);

const TOKEN_ENUM = ["USDC", "USDT", "HSK"] as const;
const tokenSchema = z.enum(TOKEN_ENUM).openapi({
  description: "Supported settlement token symbol on HashKey Chain.",
  example: "USDC",
});

const addressSchema = z
  .string()
  .regex(ADDRESS_REGEX, "address must be 0x + 40 hex chars")
  .openapi({
    description: "EIP-55 hex address, 0x + 40 hex chars.",
    example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  });

const amountSchema = z
  .string()
  .regex(/^[0-9]+(\.[0-9]+)?$/, "amount must be a decimal string")
  .openapi({ description: "Positive decimal string. Avoids float drift.", example: "100.50" });

const isoDate = z.string().datetime().openapi({ example: "2026-12-31T23:59:59Z" });

// ---- SIWE: nonce ----
export const siweNonceRequest = z
  .object({
    address: addressSchema,
    chainId: z.number().int().optional().openapi({ example: 133 }),
  })
  .openapi("SiweNonceRequest");

export const siweNonceResponse = z
  .object({
    nonce: z.string(),
    message: z.string().openapi({ description: "Full SIWE message to sign verbatim." }),
    expires_in: z.number().int().openapi({ example: 300 }),
    chain_id: z.number().int().openapi({ example: 133 }),
  })
  .openapi("SiweNonceResponse");

// ---- SIWE: verify ----
export const siweVerifyRequest = z
  .object({
    message: z.string().min(1).openapi({ description: "SIWE message returned by /v1/auth/siwe/nonce." }),
    signature: z
      .string()
      .regex(/^0x[a-fA-F0-9]+$/, "signature must be 0x-prefixed hex")
      .openapi({ description: "Hex EIP-191 signature of `message`." }),
  })
  .openapi("SiweVerifyRequest");

export const siweVerifyResponse = z
  .object({
    access_token: z.string().openapi({ description: "Bearer JWT for subsequent calls." }),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().openapi({ example: 3600 }),
    scopes: z.array(z.string()),
    subject: z.string(),
    address: addressSchema,
  })
  .openapi("SiweVerifyResponse");

// ---- Compliance: check ----
export const complianceCheckRequest = z
  .object({ address: addressSchema })
  .openapi("ComplianceCheckRequest");

export const complianceCheckResponse = z
  .object({
    address: addressSchema,
    sanctions_ok: z.boolean(),
    score: z.number(),
    checked_at: isoDate,
    sources: z.array(z.string()),
    velocity: z.object({
      window_hours: z.number().int(),
      total_usd: z.number(),
      tx_count: z.number().int(),
      limit_usd: z.number(),
    }),
    details: z.object({
      reason: z.string(),
      detail: z.string().optional(),
    }),
  })
  .openapi("ComplianceCheckResponse");

// ---- Invoices ----
export const invoiceCreateRequest = z
  .object({
    receiver_address: addressSchema,
    amount: amountSchema,
    token: tokenSchema,
    purpose: z.string().max(500).optional(),
    due_at: isoDate.optional(),
  })
  .openapi("InvoiceCreateRequest");

export const invoiceResponse = z
  .object({
    invoice_id: z.string().openapi({ example: "inv_01J..." }),
    flowlink_id: z.string().openapi({ example: "flowlink:inv/inv_01J..." }),
    status: z.enum(["pending", "paying", "paid", "expired", "cancelled"]),
    receiver_address: addressSchema,
    amount: amountSchema,
    token: tokenSchema,
    chain_id: z.number().int().openapi({ example: 133 }),
    purpose: z.string().nullable().optional(),
    due_at: isoDate,
    created_at: isoDate,
    paid_at: isoDate.nullable().optional(),
  })
  .openapi("InvoiceResponse");

// ---- Pay ----
export const payRequest = z
  .object({
    invoice_id: z.string().min(1),
    payer_address: addressSchema,
    token: tokenSchema.optional(),
  })
  .openapi("PayRequest");

export const payResponse = z
  .object({
    transaction_id: z.string(),
    flowlink_id: z.string(),
    status: z.string().openapi({ example: "mandate_created" }),
    checkout_url: z.string().nullable(),
    hsp_mandate_id: z.string().nullable(),
    hsp_configured: z.boolean(),
    compliance: z.object({
      score: z.number(),
      sanctions_ok: z.boolean(),
      checked_at: isoDate,
    }),
    events_url: z.string(),
    expected_settlement_sec: z.number().int().openapi({ example: 30 }),
  })
  .openapi("PayResponse");

// ---- Transactions ----
export const transactionResponse = z
  .object({
    transaction_id: z.string(),
    flowlink_id: z.string(),
    invoice_id: z.string().nullable(),
    status: z.string(),
    payer_address: addressSchema,
    receiver_address: addressSchema,
    amount: amountSchema,
    token: tokenSchema,
    chain_id: z.number().int(),
    tx_hash: z.string().nullable(),
    block: z.number().int().nullable(),
    hsp_mandate_id: z.string().nullable(),
    checkout_url: z.string().nullable(),
    compliance_score: z.number().nullable(),
    created_at: isoDate,
    settled_at: isoDate.nullable(),
    failed_at: isoDate.nullable(),
    failure_code: z.string().nullable(),
    events: z.array(
      z.object({
        type: z.string(),
        data: z.record(z.unknown()),
        at: isoDate,
      }),
    ),
  })
  .openapi("TransactionResponse");

// ---- Receipts ----
export const receiptResponse = z
  .object({
    receipt_id: z.string().optional(),
    transaction_id: z.string().optional(),
    invoice_id: z.string().optional(),
    amount: amountSchema.optional(),
    token: tokenSchema.optional(),
    chain_id: z.number().int().optional(),
    tx_hash: z.string().optional(),
    block: z.number().int().optional(),
    settled_at: isoDate.optional(),
    signed_payload_hash: z.string().optional(),
    signature: z.object({
      algo: z.string().openapi({ example: "ed25519" }),
      signer: z.string().openapi({ example: "flowlink.ink" }),
      key_id: z.string(),
      signed_payload_hash: z.string(),
      signature: z.string(),
      public_key_url: z.string().url(),
    }),
  })
  .passthrough()
  .openapi("ReceiptResponse");

// ---- Reputation ----
export const reputationResponse = z
  .object({
    address: addressSchema,
    score: z.number().openapi({ example: 73 }),
    tx_count: z.number().int(),
    volume_usd: z.number(),
    on_time_rate: z.number(),
    disputes: z.number().int(),
    first_seen: isoDate.optional(),
    last_seen: isoDate.optional(),
    as_payer: z.object({ count: z.number().int(), volume_usd: z.number() }),
    as_payee: z.object({ count: z.number().int(), volume_usd: z.number() }),
    compliance_flags: z.array(z.string()),
  })
  .openapi("ReputationResponse");

// ---- RFC 9457 Problem+JSON envelope ----
// Mirrors the body returned by src/lib/errors.ts::problemJson.
export const problemJsonResponse = z
  .object({
    type: z.string().url().openapi({ example: "https://flowlink.ink/errors/invoice_not_found" }),
    title: z.string(),
    status: z.number().int(),
    code: z.string().openapi({ example: "invoice_not_found" }),
    detail: z.string(),
    instance: z.string().optional(),
    request_id: z.string().optional(),
    retry_after: z.number().int().optional(),
    agent_action: z.string().openapi({
      description: "Plain-language guidance for autonomous callers on what to do next.",
    }),
  })
  .passthrough()
  .openapi("ProblemJsonResponse");
