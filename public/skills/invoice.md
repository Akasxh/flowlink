---
skill: invoice
version: 1.0.0
stability: stable
auth: [siwe, api-key]
scopes: [invoice:read, invoice:write]
idempotent: true
related_skills: [pay, compliance]
---

# invoice

Create and read FlowLink invoices. An invoice is the canonical object a payer settles against.

## create_invoice

**Request**

```http
POST /v1/invoices HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: 01HV9ZBXC8N5KEXAMPLE

{
  "receiver_address": "0xPAYEE...",
  "amount": "10.00",
  "token": "USDC",
  "purpose": "Q3 compliance audit",
  "due_at": "2026-05-15T23:59:59Z"
}
```

**Response 201 Created**

```json
{
  "invoice_id": "inv_01HV9Z...",
  "status": "pending",
  "receiver_address": "0xPAYEE...",
  "amount": "10.00",
  "token": "USDC",
  "chain_id": 133,
  "due_at": "2026-05-15T23:59:59Z",
  "created_at": "2026-04-22T14:02:11Z",
  "flowlink_id": "flowlink:inv/01HV9Z..."
}
```

Request fields:

| field | type | required | notes |
|---|---|---|---|
| `receiver_address` | EIP-55 address | yes | Must pass `compliance.check` or request rejected. |
| `amount` | decimal string | yes | Positive. Max 6 decimals for USDC/USDT, 18 for HSK. |
| `token` | enum | yes | `USDC` \| `USDT` \| `HSK`. |
| `purpose` | string ≤500 | no | Human-readable. Stored verbatim. |
| `due_at` | ISO 8601 | no | Defaults to 30 days from creation. Past dates rejected. |

## get_invoice

```http
GET /v1/invoices/inv_01HV9Z... HTTP/1.1
Authorization: Bearer <token>
```

Returns the full invoice record. `status` ∈ `pending | paying | paid | expired | cancelled`.

## cancel_invoice

```http
DELETE /v1/invoices/inv_01HV9Z... HTTP/1.1
Authorization: Bearer <token>
Idempotency-Key: ...
```

Only callable by the invoice creator. Only valid while `status == pending`.

## Errors

| code | status | agent should |
|---|---|---|
| `auth_required` | 401 | Provide bearer token. |
| `insufficient_scope` | 403 | Need `invoice:write` to create. |
| `validation_error` | 400 | Fix the field in `detail`. |
| `compliance_blocked_sanctions` | 403 | Receiver flagged. Do NOT retry. |
| `invoice_not_found` | 404 | Verify id. |
| `invoice_not_cancellable` | 409 | Already paid or expired. |
| `idempotency_conflict` | 409 | Different body with same key. |

Full catalogue: [/skills/errors.md](./errors.md)

## Related

- [pay](./pay.md) — settle an invoice
- [compliance](./compliance.md) — preflight the receiver before creating
