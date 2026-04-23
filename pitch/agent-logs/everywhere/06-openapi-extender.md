# OpenAPI Extender — Round 2

Extended the OpenAPI 3.1 generator to cover the admin surface alongside the
13 existing /v1/* operations.

In `src/lib/schemas/v1.ts`: added five Zod components (with `.openapi(...)`
extension calls in the same style as the existing schemas) — `apiKeyListResponse`
(envelope `{ data, count }` of summaries with id/name/prefix/scopes/env/timestamps),
`apiKeyMintRequest` (`{ name, scopes[], env: 'live'|'test' }`), `apiKeyMintResponse`
(`{ id, prefix, scopes[], env, rawKey }` with rawKey description flagged "shown
ONCE… never retrievable again"), `apiKeyRevokeRequest` (`{ id }`), and
`observabilityResponse` mirroring `access-log.ts::Summary`
(windowSec, totalCount, p50, p95, fivexxRate, topFingerprints[],
statusBreakdown[], routes[] of RouteStat, generatedAt). Reused private
`apiKeyScopeSchema` / `apiKeyEnvSchema` enums to stay aligned with
`auth/apikey.ts::ApiKeyScope`.

In `src/lib/openapi.ts`: registered the five new components, declared a new
`adminToken` security scheme (`{ type: "apiKey", in: "header", name: "X-Admin-Token" }`)
alongside the existing bearerAuth, and wired four routes — `GET /api/admin/keys`,
`POST /api/admin/keys`, `DELETE /api/admin/keys`, `GET /api/admin/observability`
(with `window` query param documented, default 300) — all tagged `["admin"]`
and gated by adminToken. Error responses match the actual handlers (401 / 404
/ 500 admin-disabled).

In `src/lib/openapi.test.ts`: added three assertions — admin paths exist with
the right HTTP verbs (GET/POST/DELETE under /keys), `adminToken` apiKey scheme
with the X-Admin-Token header is present, and operation count >= 17 (counted
on emitted method verbs since /api/admin/keys is one path object hosting three
operations).

Results: `pnpm typecheck` exit 0. `pnpm test` exit 1 — all 8 openapi tests
pass; the only failures are 2 pre-existing assertions in `src/lib/mcp.test.ts`
(MCP_TOOLS catalogue grew 6 -> 10, unrelated to this work and outside file
ownership). Generated YAML now emits 17 operations across 13 path objects.
