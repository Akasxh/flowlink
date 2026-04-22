// RFC 9457 Problem+JSON helper. Zero dependencies on other lib modules.
//
// Usage:
//   return problemJson({ code: "invoice_not_found", detail: "id=inv_..." });
//
// The catalogue of codes lives in public/skills/errors.md. When you add a new code
// here, update that file in the same PR or CI will fail.

export type ProblemCode =
  // Auth (401/403)
  | "auth_required"
  | "invalid_credentials"
  | "token_expired"
  | "insufficient_scope"
  // Validation (400)
  | "validation_error"
  | "invalid_token"
  | "chain_id_mismatch"
  | "missing_idempotency_key"
  // Not found (404)
  | "invoice_not_found"
  | "receipt_not_found"
  | "transaction_not_found"
  | "not_found"
  // Conflict (409/410)
  | "invoice_already_paid"
  | "invoice_not_cancellable"
  | "invoice_expired"
  | "idempotency_conflict"
  // Compliance (403/429/503)
  | "compliance_blocked_sanctions"
  | "compliance_blocked_velocity"
  | "compliance_upstream_unavailable"
  // Rate limits (429)
  | "rate_limited"
  // Upstream (502/503)
  | "hsp_upstream_error"
  | "rpc_upstream_error"
  | "mandate_creation_failed"
  // Internal (500)
  | "internal_error";

type CatalogueEntry = {
  status: number;
  title: string;
  agentAction: string;
};

const CATALOGUE: Record<ProblemCode, CatalogueEntry> = {
  auth_required: {
    status: 401,
    title: "Authentication required",
    agentAction: "Provide Authorization: Bearer <token>. See /.well-known/flowlink.md for SIWE flow.",
  },
  invalid_credentials: {
    status: 401,
    title: "Invalid credentials",
    agentAction: "Token signature invalid or malformed. Re-run SIWE.",
  },
  token_expired: {
    status: 401,
    title: "Token expired",
    agentAction: "Refresh via /v1/auth/siwe/refresh or re-SIWE.",
  },
  insufficient_scope: {
    status: 403,
    title: "Insufficient scope",
    agentAction: "Token lacks the required scope. Request a new token with the correct scope.",
  },
  validation_error: {
    status: 400,
    title: "Validation error",
    agentAction: "Fix the field described in detail.",
  },
  invalid_token: {
    status: 400,
    title: "Token not supported",
    agentAction: "Use one of: USDC, USDT, HSK.",
  },
  chain_id_mismatch: {
    status: 400,
    title: "Chain id mismatch",
    agentAction: "Switch wallet to HashKey chain id 133.",
  },
  missing_idempotency_key: {
    status: 400,
    title: "Missing idempotency key",
    agentAction: "Provide Idempotency-Key: <ULID> header on this write.",
  },
  invoice_not_found: {
    status: 404,
    title: "Invoice not found",
    agentAction: "Verify invoice_id came from a successful create response.",
  },
  receipt_not_found: {
    status: 404,
    title: "Receipt not found",
    agentAction: "Wait for receipt_ready SSE event before requesting the receipt.",
  },
  transaction_not_found: {
    status: 404,
    title: "Transaction not found",
    agentAction: "Verify transaction_id.",
  },
  not_found: {
    status: 404,
    title: "Not found",
    agentAction: "Resource does not exist.",
  },
  invoice_already_paid: {
    status: 409,
    title: "Invoice already paid",
    agentAction: "Call GET /v1/receipts?invoice_id=... to retrieve the receipt. Do NOT retry the pay call.",
  },
  invoice_not_cancellable: {
    status: 409,
    title: "Invoice not cancellable",
    agentAction: "Invoice is already paid or expired. No action needed.",
  },
  invoice_expired: {
    status: 410,
    title: "Invoice expired",
    agentAction: "Ask the payee to issue a fresh invoice.",
  },
  idempotency_conflict: {
    status: 409,
    title: "Idempotency conflict",
    agentAction: "Same key with a different body. Use a fresh Idempotency-Key, or resend the original body byte-for-byte.",
  },
  compliance_blocked_sanctions: {
    status: 403,
    title: "Address is sanctioned",
    agentAction: "Stop. Do NOT retry. Escalate to a human.",
  },
  compliance_blocked_velocity: {
    status: 429,
    title: "Velocity ceiling exceeded",
    agentAction: "Wait retry_after seconds and retry.",
  },
  compliance_upstream_unavailable: {
    status: 503,
    title: "Compliance upstream unavailable",
    agentAction: "Backoff and retry. FlowLink blocks payments when the OFAC source is unreachable (fail-closed by design).",
  },
  rate_limited: {
    status: 429,
    title: "Rate limit exceeded",
    agentAction: "Respect Retry-After. Do not parallel-retry.",
  },
  hsp_upstream_error: {
    status: 502,
    title: "HSP upstream error",
    agentAction: "Exponential backoff 1→2→4 s, max 3 retries. Surface after.",
  },
  rpc_upstream_error: {
    status: 502,
    title: "Chain RPC upstream error",
    agentAction: "Exponential backoff and retry.",
  },
  mandate_creation_failed: {
    status: 502,
    title: "Mandate creation failed",
    agentAction: "Usually HSP. Same recovery as hsp_upstream_error.",
  },
  internal_error: {
    status: 500,
    title: "Internal error",
    agentAction: "Retry once. If persistent, contact support with request_id.",
  },
};

export type ProblemInput = {
  code: ProblemCode;
  detail?: string;
  instance?: string;
  requestId?: string;
  retryAfter?: number;
  extras?: Record<string, unknown>;
};

export function problemJson(input: ProblemInput): Response {
  const entry = CATALOGUE[input.code];
  const body = {
    type: `https://flowlink.ink/errors/${input.code}`,
    title: entry.title,
    status: entry.status,
    code: input.code,
    detail: input.detail ?? entry.title,
    instance: input.instance ?? undefined,
    request_id: input.requestId ?? undefined,
    retry_after: input.retryAfter ?? undefined,
    agent_action: entry.agentAction,
    ...(input.extras ?? {}),
  };
  const headers: HeadersInit = {
    "Content-Type": "application/problem+json",
  };
  if (input.retryAfter != null) {
    headers["Retry-After"] = String(input.retryAfter);
  }
  if (input.requestId) {
    headers["X-Request-Id"] = input.requestId;
  }
  return new Response(JSON.stringify(body), {
    status: entry.status,
    headers,
  });
}

// For non-problem 4xx/5xx callers that still want the envelope.
export function problemFromUnknown(err: unknown, requestId?: string): Response {
  const detail = err instanceof Error ? err.message : String(err);
  return problemJson({ code: "internal_error", detail, requestId });
}
