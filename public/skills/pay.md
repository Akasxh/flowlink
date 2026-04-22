---
skill: pay
version: 1.0.0
stability: stable
auth: [siwe, api-key]
scopes: [pay:execute]
idempotent: true
rate_limit: "20 requests / minute / key"
settlement_chain: hashkey-testnet-133
related_skills: [invoice, compliance, receipt]
---

# pay

Settle a FlowLink invoice via HashKey Settlement Protocol (HSP) Single-Pay Mandate. Compliance (OFAC +
velocity) runs inline — if the payer address is sanctioned or exceeds velocity limits, the call is
rejected before any on-chain activity.

## When to use

- You have a valid `invoice_id` from a prior `invoice.create` response.
- You want OFAC + velocity screening before funds move.
- You want a cryptographically signed receipt afterward.

## When NOT to use

- Only want to screen an address? Use `compliance.check`.
- Only want to create an invoice? Use `invoice.create`.
- Need recurring pulls? Not supported in v1.

## Contract

### pay_invoice

**Request**

```http
POST /v1/pay HTTP/1.1
Host: flowlink.ink
Authorization: Bearer <jwt-or-api-key>
Content-Type: application/json
Idempotency-Key: 01HV9ZBXC8N5KEXAMPLE

{
  "invoice_id": "inv_01HV9Z...",
  "payer_address": "0xabc...",
  "token": "USDC"
}
```

**Response 202 Accepted**

```json
{
  "transaction_id": "txn_01HV9Z...",
  "status": "mandate_created",
  "checkout_url": "https://checkout.hsp.hashkey.com/c/xyz",
  "hsp_mandate_id": "CM-abc-123",
  "compliance": {
    "score": 92,
    "sanctions_ok": true,
    "checked_at": "2026-04-22T14:02:11Z"
  },
  "events_url": "/v1/transactions/txn_01HV9Z.../events",
  "expected_settlement_sec": 30
}
```

### wait_for_settlement (SSE)

```http
GET /v1/transactions/txn_01HV9Z.../events HTTP/1.1
Accept: text/event-stream
Authorization: Bearer <token>
```

```
event: compliance_passed
data: {"transaction_id":"txn_...","score":92}

event: mandate_created
data: {"transaction_id":"txn_...","hsp_mandate_id":"CM-..."}

event: settled
data: {"transaction_id":"txn_...","tx_hash":"0x...","amount":"10.00","token":"USDC","block":18402913}

event: receipt_ready
data: {"transaction_id":"txn_...","receipt_id":"rcp_..."}
```

Clients can resume with `Last-Event-ID`. Channel TTL is 1 hour.

## Errors (agent-actionable)

| code | status | title | agent should |
|---|---|---|---|
| `auth_required` | 401 | Missing bearer token | Complete SIWE or provide API key. |
| `token_expired` | 401 | JWT expired | Refresh via `/v1/auth/siwe/refresh` or re-SIWE. |
| `insufficient_scope` | 403 | Token lacks `pay:execute` | Request a new token with correct scope. |
| `invoice_not_found` | 404 | Invoice does not exist | Stop. Verify `invoice_id` came from a successful create. |
| `invoice_already_paid` | 409 | Already settled | Call `receipt.get` with `invoice_id`. Do NOT retry. |
| `invoice_expired` | 410 | Past due date | Ask payee to issue a new invoice. |
| `compliance_blocked_sanctions` | 403 | Payer is sanctioned | Stop. Escalate to human. Do NOT retry. |
| `compliance_blocked_velocity` | 429 | 24h velocity ceiling exceeded | Retry after `retry_after` seconds. |
| `compliance_upstream_unavailable` | 503 | OFAC check failed; blocked fail-closed | Retry with backoff; if persistent, surface. |
| `idempotency_conflict` | 409 | Same key + different body | Use a fresh `Idempotency-Key`, or resend the original body byte-for-byte. |
| `rate_limited` | 429 | Over per-minute limit | Respect `Retry-After`. Do NOT parallel-retry. |
| `invalid_token` | 400 | Token not supported | Use USDC, USDT, or HSK. |
| `chain_id_mismatch` | 400 | Wallet wrong chain | Switch wallet to HashKey chain id 133. |
| `hsp_upstream_error` | 502 | HSP unavailable | Backoff 1→2→4 s, max 3 retries, then surface. |

Full error catalogue: [/skills/errors.md](./errors.md)

All errors are returned as `application/problem+json`:

```json
{
  "type": "https://flowlink.ink/errors/compliance_blocked_sanctions",
  "title": "Payer address is sanctioned",
  "status": 403,
  "detail": "OFAC SDN match: Tornado Cash",
  "code": "compliance_blocked_sanctions",
  "instance": "/v1/pay",
  "request_id": "req_01HV9Z...",
  "retry_after": null,
  "agent_action": "Stop. Escalate to human. Do NOT retry."
}
```

## Guarantees

- Settlement on HashKey Chain (id 133) via HSP Single-Pay Mandate.
- ProofLink emitted atomically with the settle tx (same block).
- Failed compliance → no on-chain state change.
- Idempotent within 24h per `Idempotency-Key`.
- Ed25519-signed receipt available after `receipt_ready` event.

## Copy-paste (bash)

```sh
# 1. SIWE auth (see /.well-known/flowlink.md for the signing step)
JWT="eyJ..."

# 2. Pay
curl -X POST https://flowlink.ink/v1/pay \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"invoice_id":"inv_...","payer_address":"0xYOU","token":"USDC"}'
```

## Related

- [invoice](./invoice.md) — create the `invoice_id`
- [compliance](./compliance.md) — preflight without committing
- [receipt](./receipt.md) — fetch the signed receipt after settlement
