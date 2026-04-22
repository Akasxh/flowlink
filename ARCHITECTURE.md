# FlowLink architecture

The one rule: **every `lib/*` module works in isolation**. If module A fails, unrelated modules stay up.

## Layer map

```
┌──────────────────────────────────────────────────────────────────────┐
│  public/                    Static discovery surface (agent-facing)  │
│  ├── llms.txt                                                        │
│  ├── robots.txt                                                      │
│  ├── skills/*.md            The API, in markdown                     │
│  └── .well-known/*          mcp.json, openapi.yaml, pubkeys          │
├──────────────────────────────────────────────────────────────────────┤
│  src/app/                   Next.js App Router                       │
│  ├── page.tsx               Human landing                            │
│  ├── layout.tsx                                                      │
│  └── v1/                    Machine API (agents call here)           │
│      ├── auth/siwe/{nonce,verify,refresh}/route.ts                   │
│      ├── invoices/route.ts, invoices/[id]/route.ts                   │
│      ├── pay/route.ts                                                │
│      ├── compliance/check/route.ts                                   │
│      ├── receipts/[id]/route.ts                                      │
│      ├── reputation/[address]/route.ts                               │
│      └── transactions/[id]/events/route.ts      (SSE)                │
├──────────────────────────────────────────────────────────────────────┤
│  src/lib/                   Independent, testable modules            │
│  ├── errors.ts              Problem+JSON helper (0 deps)             │
│  ├── idempotency.ts         Middleware (Prisma only)                 │
│  ├── ratelimit.ts           Memory-or-Redis (env-gated)              │
│  ├── auth/                                                           │
│  │   ├── siwe.ts            Nonce issue + EIP-4361 verify            │
│  │   ├── jwt.ts             Ed25519 sign/verify + JWKS               │
│  │   ├── apikey.ts          Scoped key lookup                        │
│  │   └── middleware.ts      Combined Bearer auth                     │
│  ├── compliance.ts          OFAC + velocity (fail-closed)            │
│  ├── receipts.ts            Ed25519 sign/verify receipts             │
│  ├── hsp.ts                 HSP client + webhook verify (graceful)   │
│  ├── chain.ts               HashKey chain config                     │
│  └── prisma.ts              Client singleton                         │
├──────────────────────────────────────────────────────────────────────┤
│  prisma/schema.prisma       Single schema, SQLite-dev/Postgres-prod  │
└──────────────────────────────────────────────────────────────────────┘
```

## Module independence rules

1. **No `lib/*` module imports another `lib/*` module** except `prisma.ts` (used everywhere) and
   `errors.ts` (used everywhere). These two are the leaves; everything else is independent.
2. **No module pulls env vars at import time.** Env reads happen inside exported functions so tests can
   stub them.
3. **Each module exports a narrow interface.** No default exports. No implementation detail leakage.
4. **Failure of upstream never cascades.** `lib/hsp` being down does not fail `lib/compliance`. A route
   that uses both decides how to compose their verdicts.

## Failure modes and graceful degradation

| Component down | What still works |
|---|---|
| HSP (upstream) | auth, compliance check, invoice create/read, receipt read |
| OFAC upstream | auth, invoice CRUD, receipt read, HSP settlement. `/v1/pay` returns 503 fail-closed. |
| Prisma DB | `llms.txt`, skill files, `.well-known/*` all static. `/v1/*` returns 503. |
| Upstash Redis | in-memory fallback for ratelimit + idempotency in dev; prod requires Redis. |
| JWT signing key missing | `/v1/auth/siwe/verify` returns 503. Non-auth routes unaffected. |
| Receipt signing key missing | `/v1/pay` still creates the mandate; receipt is marked `unsigned` and surfaced as an error to the payer. |

## Invariants enforced in CI

- `pnpm typecheck` passes with zero errors (no `ignoreBuildErrors`).
- `pnpm lint` passes with zero warnings.
- `pnpm test` passes (Vitest, each `lib/*` has a `.test.ts` alongside).
- No file in `public/skills/` exceeds 10 KB.
- No `process.env.*` reference at module top-level (only inside functions).
- No import of `lib/X` from `lib/Y` unless X is `prisma` or `errors`.

## Adding a new capability

1. Write the skill markdown first: `public/skills/<thing>.md`.
2. Add the module: `src/lib/<thing>.ts` with an exported interface.
3. Write the test: `src/lib/<thing>.test.ts` (no dependency on other lib modules).
4. Wire the route: `src/app/v1/<thing>/route.ts` (only imports lib modules, errors, prisma).
5. Update `llms.txt` and `/.well-known/mcp.json` to list the skill.
6. Ship.

If step 3 depends on step 2 being live in the DB, you broke rule 1.
