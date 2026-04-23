# v0.2 — Agent Observability Tab

## Shipped
A live observability surface for FlowLink's `/v1/*` traffic, mirroring slide 5's right panel in `pitch/v0.2-preview.html`. Every wrapped route now writes a row to a new `AgentAccessLog` Prisma table, and `/dashboard/agents` polls a 5-min summary every 5s.

## Pieces
- **`src/lib/agent-fingerprint.ts`** — pure helper. Hashes `User-Agent + Accept + Accept-Language` with sha256, takes the first 12 hex chars. Same agent stack from the same machine produces the same fingerprint; IP is deliberately excluded so NAT/edge churn doesn't fragment groups.
- **`src/lib/access-log.ts`** — `log()` writes one row per request; `summary(windowSec)` pulls rows in the window and computes p50, p95, status breakdown, top fingerprints, and per-(fingerprint, route, method) buckets in-process. SQLite has no `percentile_cont`, so the aggregator runs in Node — bounded by a 50k-row cap.
- **`src/lib/with-access-log.ts`** — drop-in handler wrapper. Generic over `Req extends Request` so it accepts both `Request` and `NextRequest`. Logging is fire-and-forget in a `finally` block, so DB latency never enters the request path; failures fall back to `console.warn`.
- **`AgentAccessLog`** model added to `prisma/schema.prisma`, indexed on `createdAt` and `(fingerprint, createdAt)`. Pushed via `prisma db push`.
- **`/api/admin/observability`** — `GET ?window=300`. Same `X-Admin-Token` env-var gate as `/api/admin/keys` (returns 503 if `ADMIN_TOKEN` unset).
- **`/dashboard/agents`** — server shell + client `ObsPanel.tsx` (4 stat tiles, polling table, token gate). Added to dashboard sidebar nav.

## Demo wiring
`withAccessLog` applied to `POST /v1/invoices`, `GET /v1/invoices`, `POST /v1/pay`, `POST /v1/compliance/check` — handler logic untouched.

## Acceptance
`pnpm typecheck`, `pnpm test` (47 passed), and `pnpm build` (18 routes generated) all green. No new npm deps.
