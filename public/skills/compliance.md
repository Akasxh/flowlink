---
skill: compliance
version: 1.0.0
stability: stable
auth: [siwe, api-key, none]
scopes: [compliance:check]
idempotent: true
fail_mode: closed
related_skills: [pay, invoice]
---

# compliance

OFAC sanctions screening + 24-hour velocity check for a wallet address. Fails **closed** — if our upstream
OFAC source is unreachable, the check returns `compliance_upstream_unavailable` rather than silently
passing.

## check_sanctions

**Request**

```http
POST /v1/compliance/check HTTP/1.1
Content-Type: application/json

{
  "address": "0xabc..."
}
```

Auth optional. Public endpoint for preflights. Rate-limited per IP when anonymous.

**Response 200**

```json
{
  "address": "0xabc...",
  "sanctions_ok": true,
  "score": 92,
  "checked_at": "2026-04-22T14:02:11Z",
  "sources": ["ofac-sdn", "velocity-24h"],
  "velocity": {
    "window_hours": 24,
    "total_usd": 120.50,
    "tx_count": 3,
    "limit_usd": 10000
  },
  "details": {
    "ofac": "clear",
    "velocity": "within_limits"
  }
}
```

**Response 403 (sanctioned)**

```json
{
  "type": "https://flowlink.ink/errors/compliance_blocked_sanctions",
  "title": "Address is sanctioned",
  "status": 403,
  "code": "compliance_blocked_sanctions",
  "detail": "OFAC SDN match: Tornado Cash 0x..."
}
```

## Scoring

`score` is 0–100, where:

- 100 = fully clear (no hits, no velocity concern)
- 60–99 = clear (within velocity limits, no OFAC hit)
- 30–59 = velocity concern (approaching daily limits)
- 0–29 = blocked (OFAC hit or velocity ceiling exceeded)

The minimum acceptable score for `pay` is **60** by default. A score below 60 causes `pay` calls to return
`compliance_blocked_velocity` or `compliance_blocked_sanctions`.

## batch_check (up to 20 addresses)

```http
POST /v1/compliance/check/batch HTTP/1.1
Content-Type: application/json

{"addresses": ["0xabc...", "0xdef...", ...]}
```

Returns an array in the same order. Individual failures are reported inline; the overall request does not
fail unless all addresses fail.

## Upstream sources

- OFAC SDN Ethereum list (refreshed nightly from `api.ofac.dev`)
- Known-bad-actor list (Tornado Cash, Lazarus, etc. — hardcoded fallback)
- FlowLink velocity ledger (24h rolling window, per address)

## Errors

| code | status | agent should |
|---|---|---|
| `validation_error` | 400 | Address not EIP-55 formatted. Fix and retry. |
| `compliance_upstream_unavailable` | 503 | OFAC source down. Retry with backoff. This is **intentional** — we fail closed. |
| `rate_limited` | 429 | Slow down, respect `Retry-After`. |

## Related

- [pay](./pay.md) — this check runs inline on every pay
- [invoice](./invoice.md) — receiver is preflighted at create time
