---
skill: dashboard
version: 1.0.0
stability: stable
auth: [admin-token]
scopes: [admin]
related_skills: [invoice, pay, receipt]
---

# dashboard

`/dashboard/keys` and `/dashboard/agents` are thin React shells over
two JSON endpoints. Do NOT scrape the HTML — call the admin API.

## What the human pages do

- `/dashboard/keys` — mint/list/revoke scoped API keys. Six scopes:
  `invoice:read`, `invoice:write`, `pay:execute`, `receipt:read`,
  `compliance:check`, `reputation:read`. Raw key shown once.
- `/dashboard/agents` — live obs over `/v1/*`, grouped by a 12-char
  fingerprint of `User-Agent + Accept + Accept-Language`. P50/P95/5xx,
  top fingerprint, per-route counts. Polls every 5s.

Nothing in the DOM the JSON does not already give you.

## Auth

`/api/admin/*` gated by `X-Admin-Token` matched against
`process.env.ADMIN_TOKEN`. Unset env → `internal_error` /
`detail: "admin disabled"`. v0.2 shared secret, no per-user id.

**Do NOT bake `X-Admin-Token` into production integrations.** v0.3
swaps this for a scoped JWT via the SIWE flow used by `/v1/*`, with a
dedicated `admin:*` scope family. Treat the current token as throwaway.

## mint_api_key

POST a name + scope set, get the raw key exactly once. Server stores
only a SHA-256 hash; lose the response and the key is gone — mint another.

```http
POST /api/admin/keys HTTP/1.1
X-Admin-Token: <ADMIN_TOKEN>
Content-Type: application/json

{"name":"mcp-bridge-laptop","scopes":["invoice:read","receipt:read"],"env":"test"}
```

| field | type | req | notes |
|---|---|---|---|
| `name` | string 1..80 | yes | Human label. Trimmed. |
| `scopes` | string[] | yes | ≥1. Subset of the six above. |
| `env` | enum | no | `test` (default) or `live`. Test keys never settle real funds. |

**Response 201**

```json
{
  "id": "key_01HV9Z...",
  "rawKey": "flk_test_abcd...xyz",
  "prefix": "flk_test_abcd",
  "scopes": ["invoice:read", "receipt:read"],
  "env": "test"
}
```

`rawKey` → `Authorization: Bearer <rawKey>` for `/v1/*`. Persist now.

`GET /api/admin/keys` lists up to 100 keys (newest first) with
`prefix`/`scopes`/`env`/`last_used_at`/`revoked_at`; raw key never
returned again. `DELETE /api/admin/keys` with `{"id":"..."}` revokes;
calls signed with that key fail immediately.

## query_observability

`GET /api/admin/observability?window=300` with `X-Admin-Token` header.
`window` is seconds (default 300, max 86400).

**Response 200**

```json
{
  "windowSec": 300,
  "totalCount": 1284,
  "p50": 47,
  "p95": 312,
  "fivexxRate": 0.0023,
  "topFingerprints": [{"fingerprint":"a1b2c3d4e5f6","count":812}],
  "statusBreakdown": [{"status":200,"count":1248},{"status":429,"count":33}],
  "routes": [
    {"fingerprint":"a1b2c3d4e5f6","route":"/v1/invoices","method":"POST","p50":41,"p95":188,"count":402,"topStatus":201}
  ],
  "generatedAt": "2026-04-22T14:02:11Z"
}
```

Latencies in ms. `fivexxRate` is a fraction in [0,1]. Fingerprints are
deterministic per `(User-Agent, Accept, Accept-Language)` triple — same
agent stack from the same machine collapses to one row.

## Errors

Same `application/problem+json` as `/v1/*`. Relevant codes:

| code | status | agent should |
|---|---|---|
| `auth_required` | 401 | Provide `X-Admin-Token`. |
| `validation_error` | 400 | Fix field in `detail`. |
| `not_found` | 404 | Verify `id` belongs to this admin user. |
| `internal_error` | 500 | `detail: "admin disabled"` → `ADMIN_TOKEN` unset; surface to operator. |

Full catalogue: [/skills/errors.md](./errors.md)

## Copy-paste

```sh
T="$ADMIN_TOKEN"

# mint
curl -X POST https://flowlink.ink/api/admin/keys \
  -H "X-Admin-Token: $T" -H "Content-Type: application/json" \
  -d '{"name":"mcp-bridge","scopes":["invoice:read","receipt:read"],"env":"test"}'

# observe
curl -H "X-Admin-Token: $T" \
  "https://flowlink.ink/api/admin/observability?window=300"
```

## Related

[invoice](./invoice.md), [pay](./pay.md), [receipt](./receipt.md) —
the `/v1/*` surface minted keys authenticate against.
