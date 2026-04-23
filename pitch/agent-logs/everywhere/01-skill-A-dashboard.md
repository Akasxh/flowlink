# Skill A — dashboard.md

Authored `/public/skills/dashboard.md` (3,998 B, under the 4 KB cap).
Frontmatter mirrors pay.md/invoice.md (skill, version 1.0.0, stable,
auth: admin-token, scopes: admin, related: invoice/pay/receipt). Opens
by telling agents the human pages at `/dashboard/keys` and
`/dashboard/agents` are React shells — do NOT scrape, hit `/api/admin/*`
directly. Documents two sub-skills: `mint_api_key`
(POST /api/admin/keys with name/scopes/env, returns rawKey once,
SHA-256 hash on disk) and `query_observability` (GET /api/admin/observability
with windowSec, returns p50/p95/5xx/topFingerprints/routes). List + revoke
condensed inline. Auth section flags `X-Admin-Token` as v0.2 dev
convenience and points to v0.3 scoped-JWT plan. Curl examples + errors
table referencing errors.md.
