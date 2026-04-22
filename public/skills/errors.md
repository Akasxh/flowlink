---
skill: errors
version: 1.0.0
stability: stable
---

# errors

Every `/v1/*` error response is `application/problem+json` (RFC 9457) with these fields:

| field | type | always present | purpose |
|---|---|---|---|
| `type` | URL | yes | Link back to this catalogue: `https://flowlink.ink/errors/<code>` |
| `title` | string | yes | Human-readable one-liner |
| `status` | int | yes | Equals the HTTP status |
| `code` | string | yes | Machine-readable. Match on this, not `title`. |
| `detail` | string | yes | Context-specific diagnostic |
| `instance` | path | yes | The route that emitted the error |
| `request_id` | ULID | yes | Echoes `X-Request-Id` header |
| `retry_after` | int seconds | on 429/503 | How long to wait before retrying |
| `agent_action` | string | yes | What an agent should do. Read this first. |

## Full catalogue

### Auth (401 / 403)

| code | status | agent action |
|---|---|---|
| `auth_required` | 401 | Provide `Authorization: Bearer <token>`. See /.well-known/flowlink.md. |
| `invalid_credentials` | 401 | Token signature invalid or malformed. Re-SIWE. |
| `token_expired` | 401 | Refresh via `/v1/auth/siwe/refresh` or re-SIWE. |
| `insufficient_scope` | 403 | Token lacks the required scope. Request a new token. |

### Validation (400)

| code | status | agent action |
|---|---|---|
| `validation_error` | 400 | Fix the field in `detail`. |
| `invalid_token` | 400 | Use one of: USDC, USDT, HSK. |
| `chain_id_mismatch` | 400 | Switch wallet to HashKey chain id 133. |
| `missing_idempotency_key` | 400 | Provide `Idempotency-Key: <ULID>` header. |

### Not found (404)

| code | status | agent action |
|---|---|---|
| `invoice_not_found` | 404 | Verify `invoice_id` came from a successful create. |
| `receipt_not_found` | 404 | Wait for `receipt_ready` SSE event first. |
| `transaction_not_found` | 404 | Verify `transaction_id`. |
| `not_found` | 404 | Generic. Resource doesn't exist. |

### Conflict (409 / 410)

| code | status | agent action |
|---|---|---|
| `invoice_already_paid` | 409 | Call `receipt.get` with `invoice_id`. Do NOT retry. |
| `invoice_not_cancellable` | 409 | Already paid or expired. |
| `invoice_expired` | 410 | Ask payee to issue a new invoice. |
| `idempotency_conflict` | 409 | Same key + different body. Use a fresh `Idempotency-Key`. |

### Compliance (403 / 429 / 503)

| code | status | agent action |
|---|---|---|
| `compliance_blocked_sanctions` | 403 | **Stop. Do NOT retry.** Escalate to human. |
| `compliance_blocked_velocity` | 429 | Wait `retry_after` seconds and retry. |
| `compliance_upstream_unavailable` | 503 | OFAC source down, blocked fail-closed. Retry with backoff. |

### Rate limits (429)

| code | status | agent action |
|---|---|---|
| `rate_limited` | 429 | Respect `Retry-After`. Do NOT parallel-retry. |

### Upstream (502 / 503)

| code | status | agent action |
|---|---|---|
| `hsp_upstream_error` | 502 | Backoff 1→2→4 s. Max 3 retries. Surface after. |
| `rpc_upstream_error` | 502 | HashKey RPC issue. Backoff + retry. |
| `mandate_creation_failed` | 502 | Usually HSP. Same recovery as `hsp_upstream_error`. |

### Internal (500)

| code | status | agent action |
|---|---|---|
| `internal_error` | 500 | Not your fault. Retry once. If persistent, file `request_id` with support. |

## Retry strategy cheat-sheet

| status | retry? | how |
|---|---|---|
| 2xx | — | success |
| 4xx (non-429) | no | fix input |
| 401/403 | only after changing token | don't hammer |
| 409 `invoice_already_paid` | no | call receipt.get |
| 429 | yes | respect `Retry-After` |
| 502/503/504 | yes | exp backoff 1s → 2s → 4s, max 3 |
| 500 | once | then surface |
