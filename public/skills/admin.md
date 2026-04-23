---
skill: admin
version: 1.0.0
stability: beta
auth: [admin-token]
scopes: []
idempotent: false
related_skills: [dashboard, errors]
---

# admin

Raw HTTP contract for FlowLink's admin surface: API-key lifecycle and observability.
Agent-friendly wrapper: [dashboard](./dashboard.md).

All endpoints live at `/api/admin/*` (internal, not `/v1/*`). All require `X-Admin-Token`.
If `ADMIN_TOKEN` is unset server-side, every endpoint returns 503 `internal_error`
(`detail: "admin disabled"`).

## list_keys

GET keys an admin has minted. No raw secrets. Capped at 100, ordered `createdAt desc`.

```http
GET /api/admin/keys HTTP/1.1
X-Admin-Token: <shared-secret>
```

**Response 200**

```json
{
  "data": [{
    "id": "ck_01HV...",
    "name": "checkout-bot",
    "prefix": "flk_test_AbCd",
    "scopes": ["pay:execute", "invoice:read"],
    "env": "test",
    "created_at": "2026-04-22T14:02:11Z",
    "last_used_at": "2026-04-22T14:18:02Z",
    "revoked_at": null,
    "expires_at": null
  }],
  "count": 1
}
```

## mint_key

Create a fresh scoped key. **The raw key is returned ONCE in `rawKey`.** Persist immediately —
`list_keys` only returns prefix + hash. No recovery path.

Scopes: `invoice:read`, `invoice:write`, `pay:execute`, `receipt:read`, `compliance:check`,
`reputation:read`. Env: `live` | `test` (default `test`).

```http
POST /api/admin/keys HTTP/1.1
X-Admin-Token: <shared-secret>
Content-Type: application/json

{"name":"checkout-bot","scopes":["pay:execute","invoice:read"],"env":"test"}
```

**Response 201**

```json
{
  "id": "ck_01HV...",
  "rawKey": "flk_test_3xK9qP...REDACT_AFTER_COPY",
  "prefix": "flk_test_3xK9",
  "scopes": ["pay:execute", "invoice:read"],
  "env": "test"
}
```

Format: `flk_{live|test}_<base58(32 bytes)>`. Stored as sha256.

## revoke_key

Disable a leaked or rotated key. Idempotent: re-revoking is a no-op success. Defence-in-depth:
a stolen `X-Admin-Token` cannot revoke keys belonging to unrelated users — route enforces
ownership and returns 404 `not_found` otherwise.

```http
DELETE /api/admin/keys HTTP/1.1
X-Admin-Token: <shared-secret>
Content-Type: application/json

{"id": "ck_01HV..."}
```

**Response 200** — `{"id": "ck_01HV...", "revoked": true}`

## observability

Rolling summary of `/v1/*` traffic: top fingerprints, latency p50/p95, status breakdown.
No PII; fingerprints are coarse route+method buckets. `Cache-Control: no-store`.

```http
GET /api/admin/observability?window=300 HTTP/1.1
X-Admin-Token: <shared-secret>
```

`window` is seconds, default 300, max 86400. Invalid values fall back to 300.

**Response 200**

```json
{
  "window_sec": 300,
  "totals": {"requests": 1284, "errors": 17},
  "latency_ms": {"p50": 42, "p95": 318},
  "status_breakdown": {"2xx": 1242, "4xx": 25, "5xx": 17},
  "top_fingerprints": [
    {"route": "POST /v1/pay", "count": 412, "p95_ms": 612, "error_rate": 0.012}
  ]
}
```

## Errors

`application/problem+json` with `X-Request-Id`. Codes: `auth_required` (401, bad/missing token),
`validation_error` (400), `not_found` (404), `internal_error` (500/503, "admin disabled"). Full
shape: [errors](./errors.md).

## Security note

`X-Admin-Token` is a **single shared secret** from `process.env.ADMIN_TOKEN`. **Dev-only** —
anyone holding it has full keys+observability access. Acceptable for v0.2 (local dev, single
operator, no external exposure). **v0.3 will replace this with per-user NextAuth-style sessions
and scoped JWTs.** Do not expose these endpoints publicly. Do not commit the token.

## Copy-paste (bash)

```sh
H="X-Admin-Token: $ADMIN_TOKEN"; B=https://flowlink.ink/api/admin
curl -H "$H" $B/keys
curl -X POST $B/keys -H "$H" -H "Content-Type: application/json" \
  -d '{"name":"checkout-bot","scopes":["pay:execute"],"env":"test"}'
curl -X DELETE $B/keys -H "$H" -H "Content-Type: application/json" \
  -d '{"id":"ck_01HV..."}'
curl -H "$H" "$B/observability?window=300"
```

## Related

- [dashboard](./dashboard.md) — agent-friendliness wrapper over this surface
- [errors](./errors.md) — full problem+json catalogue
