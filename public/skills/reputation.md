---
skill: reputation
version: 1.0.0
stability: beta
auth: [none, siwe, api-key]
scopes: [reputation:read]
related_skills: [compliance]
---

# reputation

Query the portable reputation score of any wallet address. Derived from the history of signed FlowLink
receipts involving that address — **no self-reporting**.

> **Beta.** Scoring weights may change. The raw fact fields (`tx_count`, `volume_usd`, `first_seen`) are
> stable; the derived `score` is not pinned until v1.1.

## get_reputation

```http
GET /v1/reputation/{address} HTTP/1.1
```

No auth required. Public data — a reputation score visible only to the queryer defeats the point.

**Response 200**

```json
{
  "address": "0xabc...",
  "score": 94,
  "tx_count": 142,
  "volume_usd": 82400.50,
  "on_time_rate": 0.99,
  "disputes": 0,
  "first_seen": "2026-01-14T10:22:00Z",
  "last_seen": "2026-04-22T13:58:00Z",
  "as_payer": { "count": 87, "volume_usd": 60400.00 },
  "as_payee": { "count": 55, "volume_usd": 22000.50 },
  "compliance_flags": []
}
```

**Response 404** — no FlowLink activity found for the address.

## Score factors (current weighting, subject to change)

| factor | weight | direction |
|---|---|---|
| `tx_count` (log-scaled) | 25% | more is better, saturates around 200 |
| `on_time_rate` | 25% | higher is better |
| `volume_usd` (log-scaled) | 20% | more is better, saturates around $100k |
| `disputes` | 20% | zero is baseline, each dispute -10 points |
| `account_age_days` | 10% | older is better, saturates at 1 year |

## Why it matters

- Agent-to-agent commerce needs a trust signal no single party controls.
- DeFi protocols can accept the score as soft collateral.
- TradFi can consume the score as proof of financial behavior.

## Errors

| code | status | agent should |
|---|---|---|
| `validation_error` | 400 | Address not EIP-55 formatted. |
| `not_found` | 404 | No FlowLink activity for this address yet. |
| `rate_limited` | 429 | Slow down, respect `Retry-After`. |

## Related

- [compliance](./compliance.md) — different surface: sanctions + velocity, not reputation
