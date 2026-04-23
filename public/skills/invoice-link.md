---
skill: invoice-link
version: 1.0.0
stability: stable
auth: [none]
scopes: []
related_skills: [invoice, pay, compliance, receipt]
---

# invoice-link

A public, agent-readable view of any FlowLink invoice. Designed to be encoded in QR codes,
NFC tags, deep links, or simply pasted into a chat — anywhere a fresh agent needs to
understand "what is this charge?" without an SDK.

## URL pattern

```
https://flowlink.ink/i/{invoice_id}        # human-friendly HTML page (with QR)
https://flowlink.ink/i/{invoice_id}/agent  # agent-friendly markdown
```

Same invoice, two representations. The HTML page links the markdown via `<link rel="alternate">`
and HTTP `Link:` header. Agents can hit either URL.

## Agent flow

1. Get a URL (from QR scan, NFC, deep link, paste).
2. `GET <url>/agent` with `Accept: text/markdown`.
3. Parse the YAML frontmatter — that's the canonical machine-readable header:

   ```yaml
   flowlink_invoice_id: inv_01ABC...
   amount: "10.00"
   token: USDC
   chain_id: 133
   receiver_address: 0x...
   status: pending
   due_at: 2026-05-23T00:00:00Z
   spec: https://flowlink.ink/skills/pay.md
   ```

4. Decide whether to pay (compliance checks, user consent, etc.).
5. Auth via SIWE per [/skills/pay.md](./pay.md).
6. `POST /v1/pay {invoice_id, payer_address, token}` — done.

## Why a dedicated route (not just /v1/invoices/{id})

`GET /v1/invoices/{id}` requires `invoice:read` scope and an authenticated principal.
That works for a logged-in agent but breaks the "scan a QR with no prior context" flow.

`/i/{id}/agent` is the public, no-auth equivalent — every payable invoice is discoverable.
It returns ONLY the fields needed to decide whether to pay; sensitive metadata (issuer
identity, internal status timestamps beyond `created_at`, audit log) is omitted.

## Why markdown

- Trivially parseable from any HTTP client (no JSON Schema needed for the basics).
- Human-readable when an agent surfaces it to a user for confirmation.
- YAML frontmatter gives you machine fields; the body is the explainer.
- Smaller than the equivalent JSON+OpenAPI pair (~1.2 KB typical).

## Errors

| code | status | agent should |
|---|---|---|
| `not_found` | 404 | Invoice ID is wrong or expired. Stop. |

That's it — this is a public read endpoint, no other failures by design.

## Cache

`Cache-Control: public, max-age=30, s-maxage=60`. Status changes (pending→paid) propagate
within ~60s. Agents that need real-time settlement should subscribe to
`/v1/transactions/{id}/events` after paying.

## See also

- [pay.md](./pay.md) — the authenticated pay endpoint
- [compliance.md](./compliance.md) — preflight the receiver
- [receipt.md](./receipt.md) — verify the ed25519 receipt after settlement
- [invoice.md](./invoice.md) — the authenticated CRUD surface
