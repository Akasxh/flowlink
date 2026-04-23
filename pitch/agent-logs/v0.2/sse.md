# SSE endpoint — v0.2 build log

## Files created (mine, exclusive ownership)

- `src/lib/event-bus.ts` (84 LOC) — `publish` / `subscribe` / `replay`
  primitives. In-memory `Map<transactionId, Set<Handler>>` for fan-out,
  Prisma `transactionEvent` table for replay (so late SSE subscribers and
  reconnects via `Last-Event-ID` see history). Handler exceptions are
  isolated; iteration runs over a snapshot so unsubscribe-during-fan-out
  doesn't skip peers.
- `src/lib/event-bus.test.ts` (128 LOC) — 10 vitest cases covering
  single/multi subscriber delivery, unsubscribe, transaction isolation,
  throwing-handler isolation, mid-iteration unsubscribe, and four replay
  scenarios (full, cursor resume, unknown cursor fallback, non-JSON tolerance).
  Prisma is mocked via `vi.mock` to keep the unit pure.
- `src/app/v1/transactions/[id]/events/route.ts` (145 LOC) — GET-only SSE.
  `authenticate()` gate, transaction-existence check, `Last-Event-ID`
  honored, replay-then-subscribe with a buffer to preserve ordering, 15s
  `: ping\n\n` heartbeats, `req.signal.abort` + `ReadableStream.cancel`
  both teardown the subscription and timer. Headers include
  `X-Accel-Buffering: no` for nginx.

## Files modified

- `src/app/v1/pay/route.ts` — bus import + 2 `publishEvent` calls after
  the `compliance_passed` and `mandate_created` `transactionEvent.create`
  rows (~15 lines added).
- `src/app/api/webhooks/hsp/route.ts` — bus import + 3 `publishEvent`
  calls (`settled`, `receipt_ready`, `failed`) (~22 lines added).

## Typecheck

`pnpm typecheck` exits 2. **All 38 errors are pre-existing and confined to
parallel-agent territory**: 37 in `src/lib/schemas/v1.ts` (missing
zod-to-openapi extension) and 1 in `src/lib/mcp.ts` (missing `./mcp-tools`
module). I confirmed this by stashing my work and re-running typecheck
against HEAD — the same errors were present. Filtering tsc output to
`event-bus*`, `transactions/[id]/events`, `pay/route.ts`, and
`webhooks/hsp/route.ts` shows zero errors. `pnpm test event-bus` passes
10/10.

## In-memory tradeoff

Single-process in-memory pub/sub means SSE only fans out to clients on the
same Node instance as the publisher; horizontally scaling Next requires
swapping the `Map` for Redis pub/sub (or NATS/Postgres `LISTEN`) — the
exported surface (`publish`/`subscribe`/`replay`) is intentionally narrow
so that swap is mechanical, and DB-backed `replay` already covers
cross-instance catch-up on reconnect.
