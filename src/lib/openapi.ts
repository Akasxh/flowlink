// OpenAPI 3.1 registry + builder for FlowLink v1. Single source of truth for
// /.well-known/openapi.yaml. Shared shapes live in src/lib/schemas/v1.ts and
// are pre-registered as components on module load. New routes: add a
// `registerRoute(...)` call below and (if needed) a Zod component in v1.ts.

import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
  type RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { stringify as yamlStringify } from "yaml";
import * as v1 from "@/lib/schemas/v1";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

export function registerSchema<T extends z.ZodTypeAny>(name: string, schema: T): T {
  return registry.register(name, schema);
}

type Method = RouteConfig["method"];
export function registerRoute(method: Method, path: string, opts: Omit<RouteConfig, "method" | "path">): void {
  registry.registerPath({ method, path, ...opts });
}

const reqBody = (schema: z.ZodTypeAny) => ({ body: { content: { "application/json": { schema } }, required: true } });
const ok = (description: string, schema: z.ZodTypeAny) => ({ description, content: { "application/json": { schema } } });
const err = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: v1.problemJsonResponse } },
});
const bearer = [{ bearerAuth: [] as string[] }];
const admin = [{ adminToken: [] as string[] }];
const idemHeaders = z.object({ "Idempotency-Key": z.string() });

// Bootstrap: register reusable components + every v1 path.
for (const [name, schema] of [
  ["SiweNonceRequest", v1.siweNonceRequest], ["SiweNonceResponse", v1.siweNonceResponse],
  ["SiweVerifyRequest", v1.siweVerifyRequest], ["SiweVerifyResponse", v1.siweVerifyResponse],
  ["ComplianceCheckRequest", v1.complianceCheckRequest], ["ComplianceCheckResponse", v1.complianceCheckResponse],
  ["InvoiceCreateRequest", v1.invoiceCreateRequest], ["InvoiceResponse", v1.invoiceResponse],
  ["PayRequest", v1.payRequest], ["PayResponse", v1.payResponse],
  ["TransactionResponse", v1.transactionResponse], ["ReceiptResponse", v1.receiptResponse],
  ["ReputationResponse", v1.reputationResponse], ["ProblemJsonResponse", v1.problemJsonResponse],
  ["ApiKeyListResponse", v1.apiKeyListResponse], ["ApiKeyMintRequest", v1.apiKeyMintRequest],
  ["ApiKeyMintResponse", v1.apiKeyMintResponse], ["ApiKeyRevokeRequest", v1.apiKeyRevokeRequest],
  ["ObservabilityResponse", v1.observabilityResponse],
] as const) registry.register(name, schema);

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http", scheme: "bearer", bearerFormat: "JWT",
  description: "Access token issued by POST /v1/auth/siwe/verify.",
});

registry.registerComponent("securitySchemes", "adminToken", {
  type: "apiKey", in: "header", name: "X-Admin-Token",
  description:
    "Shared admin secret matched against the ADMIN_TOKEN env var. Gates the /api/admin/* surface. Replace with scoped sessions in v0.3.",
});

// Auth — SIWE
registerRoute("post", "/v1/auth/siwe/nonce", {
  summary: "Issue a SIWE nonce + message to sign",
  tags: ["auth"],
  request: reqBody(v1.siweNonceRequest),
  responses: { 200: ok("Nonce issued.", v1.siweNonceResponse), 400: err("Validation error.") },
});

registerRoute("post", "/v1/auth/siwe/verify", {
  summary: "Verify SIWE signature, return Bearer access token",
  tags: ["auth"],
  request: reqBody(v1.siweVerifyRequest),
  responses: {
    200: ok("Verified.", v1.siweVerifyResponse),
    400: err("Validation error."),
    401: err("Invalid credentials."),
  },
});

registerRoute("get", "/v1/auth/whoami", {
  summary: "Return the principal for the bearer token",
  tags: ["auth"],
  security: bearer,
  responses: {
    200: ok(
      "Principal.",
      z.object({ subject: z.string(), auth_type: z.string(), scopes: z.array(z.string()) }),
    ),
    401: err("Auth required."),
  },
});

// Compliance
registerRoute("post", "/v1/compliance/check", {
  summary: "Sanctions + velocity check on an address",
  tags: ["compliance"],
  request: reqBody(v1.complianceCheckRequest),
  responses: {
    200: ok("Lookup result.", v1.complianceCheckResponse),
    400: err("Validation error."),
    403: err("Sanctioned address."),
    429: err("Velocity ceiling exceeded or rate limited."),
    503: err("OFAC upstream unavailable (fail-closed)."),
  },
});

// Invoices
registerRoute("post", "/v1/invoices", {
  summary: "Create an invoice",
  tags: ["invoices"],
  security: bearer,
  request: { ...reqBody(v1.invoiceCreateRequest), headers: idemHeaders },
  responses: {
    201: ok("Invoice created.", v1.invoiceResponse),
    400: err("Validation or missing idempotency key."),
    401: err("Auth required."),
    403: err("Insufficient scope or sanctioned receiver."),
    409: err("Idempotency conflict."),
    503: err("Compliance upstream unavailable."),
  },
});

registerRoute("get", "/v1/invoices", {
  summary: "List the caller's invoices (most recent 50)",
  tags: ["invoices"],
  security: bearer,
  responses: {
    200: ok(
      "Invoice list.",
      z.object({ data: z.array(v1.invoiceResponse), count: z.number().int() }),
    ),
    401: err("Auth required."),
    403: err("Insufficient scope."),
  },
});

registerRoute("get", "/v1/invoices/{id}", {
  summary: "Fetch a single invoice",
  tags: ["invoices"],
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: ok("Invoice.", v1.invoiceResponse),
    401: err("Auth required."),
    403: err("Insufficient scope."),
    404: err("Invoice not found."),
  },
});

registerRoute("delete", "/v1/invoices/{id}", {
  summary: "Cancel a pending invoice",
  tags: ["invoices"],
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "Cancelled." },
    401: err("Auth required."),
    403: err("Insufficient scope."),
    404: err("Invoice not found."),
    409: err("Invoice not cancellable."),
  },
});

// Pay
registerRoute("post", "/v1/pay", {
  summary: "Initiate payment of an invoice via HSP mandate",
  tags: ["pay"],
  security: bearer,
  request: { ...reqBody(v1.payRequest), headers: idemHeaders },
  responses: {
    202: ok("Mandate created or compliance passed.", v1.payResponse),
    400: err("Validation or missing idempotency key."),
    401: err("Auth required."),
    403: err("Sanctioned payer or insufficient scope."),
    404: err("Invoice not found."),
    409: err("Invoice already paid or idempotency conflict."),
    410: err("Invoice expired."),
    429: err("Velocity ceiling exceeded."),
    502: err("HSP upstream error."),
    503: err("Compliance upstream unavailable."),
  },
});

// Transactions
registerRoute("get", "/v1/transactions/{id}", {
  summary: "Fetch a transaction with its event timeline",
  tags: ["transactions"],
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: ok("Transaction.", v1.transactionResponse),
    401: err("Auth required."),
    404: err("Transaction not found."),
  },
});

// Receipts
registerRoute("get", "/v1/receipts", {
  summary: "Lookup receipt by invoice_id or transaction_id",
  tags: ["receipts"],
  security: bearer,
  request: {
    query: z.object({
      invoice_id: z.string().optional(),
      transaction_id: z.string().optional(),
    }),
  },
  responses: {
    200: ok("Signed receipt.", v1.receiptResponse),
    400: err("Provide invoice_id or transaction_id."),
    401: err("Auth required."),
    403: err("Insufficient scope."),
    404: err("Receipt not found."),
  },
});

registerRoute("get", "/v1/receipts/{id}", {
  summary: "Fetch a receipt by id",
  tags: ["receipts"],
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: ok("Signed receipt.", v1.receiptResponse),
    401: err("Auth required."),
    403: err("Insufficient scope."),
    404: err("Receipt not found."),
  },
});

// Admin — API keys (UI helper surface, gated by X-Admin-Token; not part of /v1/*)
registerRoute("get", "/api/admin/keys", {
  summary: "List API keys for the admin user",
  tags: ["admin"],
  security: admin,
  responses: {
    200: ok("API key list.", v1.apiKeyListResponse),
    401: err("Missing or invalid X-Admin-Token."),
    500: err("Admin disabled (ADMIN_TOKEN env var unset)."),
  },
});

registerRoute("post", "/api/admin/keys", {
  summary: "Mint a new API key (raw key returned ONCE)",
  tags: ["admin"],
  security: admin,
  request: reqBody(v1.apiKeyMintRequest),
  responses: {
    201: ok("Key minted. The rawKey field is shown ONCE — store it immediately.", v1.apiKeyMintResponse),
    400: err("Validation error."),
    401: err("Missing or invalid X-Admin-Token."),
    500: err("Admin disabled (ADMIN_TOKEN env var unset)."),
  },
});

registerRoute("delete", "/api/admin/keys", {
  summary: "Revoke an API key",
  tags: ["admin"],
  security: admin,
  request: reqBody(v1.apiKeyRevokeRequest),
  responses: {
    204: { description: "Revoked." },
    400: err("Validation error."),
    401: err("Missing or invalid X-Admin-Token."),
    404: err("Key not found for this admin user."),
    500: err("Admin disabled (ADMIN_TOKEN env var unset)."),
  },
});

// Admin — observability
registerRoute("get", "/api/admin/observability", {
  summary: "Latency + status summary for the agent-facing surface",
  tags: ["admin"],
  security: admin,
  request: {
    query: z.object({
      window: z
        .number()
        .int()
        .optional()
        .openapi({ description: "Lookback window in seconds. Defaults to 300, capped at 86400.", example: 300 }),
    }),
  },
  responses: {
    200: ok("Latency / status summary for the window.", v1.observabilityResponse),
    401: err("Missing or invalid X-Admin-Token."),
    500: err("Admin disabled (ADMIN_TOKEN env var unset)."),
  },
});

// Reputation
registerRoute("get", "/v1/reputation/{address}", {
  summary: "Reputation score derived from settled FlowLink activity",
  tags: ["reputation"],
  request: { params: z.object({ address: z.string() }) },
  responses: {
    200: ok("Reputation snapshot.", v1.reputationResponse),
    400: err("Invalid address."),
    404: err("No FlowLink activity for address."),
  },
});

export function buildOpenApiYaml(): string {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  const document = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "FlowLink API",
      version: "1.0.0",
      description: "Agent-native, compliance-first payment layer on HashKey Chain.",
      license: { name: "MIT" },
    },
    servers: [{ url: "https://flowlink.ink", description: "production" }],
  });
  return yamlStringify(document);
}
