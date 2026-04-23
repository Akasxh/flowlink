# OpenAPI 3.1 auto-generation — build log

## Result

- `pnpm typecheck` exit: **0**
- `pnpm test` exit: **0** (47 tests pass; 5 new under `src/lib/openapi.test.ts`)

## Deps installed

`pnpm add @asteasolutions/zod-to-openapi yaml` exit code 0. The default
resolve picked `zod-to-openapi@8.5.0`, which has `peer zod@^4.0.0` while
FlowLink uses `zod@^3.23.8`. Pinned to `^7.3.0` (resolved 7.3.4) to match
the v3 API and silence the peer warning.

## Files created

- `src/lib/schemas/v1.ts` — canonical Zod schemas for every v1 contract
  (SIWE nonce/verify, compliance check, invoice CRUD, pay, transactions,
  receipts, reputation, RFC 9457 Problem+JSON envelope). Calls
  `extendZodWithOpenApi(z)` at the top so `.openapi(...)` is available
  regardless of import order.
- `src/lib/openapi.ts` (248 LOC, under the 250 limit) — module-singleton
  `registry`, thin wrappers `registerSchema` / `registerRoute`, and
  `buildOpenApiYaml()` returning a 3.1.0 spec. 13 paths declared across
  auth, compliance, invoices, pay, transactions, receipts, reputation;
  bearerAuth security scheme included.
- `src/app/.well-known/openapi.yaml/route.ts` — GET handler with
  `Content-Type: application/yaml; charset=utf-8` and
  `Cache-Control: public, max-age=300`. Spec built once and cached in
  module scope on first request.
- `src/lib/openapi.test.ts` — asserts non-empty output, `openapi: 3.1.0`,
  >=8 `/v1/` paths, ProblemJsonResponse component, bearerAuth scheme.

## Notes / one gotcha worth flagging

The `extendZodWithOpenApi` patch is module-global. Calling it inside
`v1.ts` means any future code that imports the schemas standalone (e.g.
routes wanting to reuse the canonical shapes for runtime validation) gets
the `.openapi(...)` chain too — harmless but worth knowing.
