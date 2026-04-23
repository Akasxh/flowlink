# v0.2 — Receipts: dev-mode synthetic settlement + flow tests

## Task A — Auto-mint receipts when HSP is not configured

`src/app/v1/pay/route.ts` previously left transactions stuck in
`compliance_passed` when no HSP creds were present, so demos and CI
runs never produced a receipt. Added a guarded block after the HSP
branch: when `hspConfigured() === false`, the route now (1) updates the
transaction to `settled` with `tx_hash="0x0"`, `block=0`, and
`settledAt=now()`; (2) marks the linked invoice `paid`; (3) appends a
`settled` event; (4) calls `signReceipt` + `storeReceipt`; (5) appends
a `receipt_ready` event carrying the receipt id; (6) surfaces
`receipt_id` in the response and switches `status` to `"settled"`. The
prod path (HSP configured) is untouched. The block carries the
verbatim comment requested, including the `tx_hash="0x0"` sentinel
rationale, and two `// TODO(merge): event-bus publish for ...`
comments next to the `settled` and `receipt_ready` event writes so the
parallel event-bus agent can wire `publishEvent(...)` at merge.

## Task B — `src/lib/receipts.flow.test.ts`

Five new vitest cases, deterministic key set in `beforeAll`:
sign/verify round-trip; tampered-amount rejection; tampered-tx_hash
rejection; PEM envelope validation always + optional `openssl pkey
-text` ED25519 confirmation when openssl is on PATH; `rcp_` prefix
check on `receipt_id`.

## Acceptance

`pnpm test`: 42 pass (baseline 26 + 5 new + 11 mcp tests already
present from another agent). `pnpm typecheck`: my changed files are
clean; only pre-existing parallel-agent WIP errors remain
(`KeysTable`, `ObsPanel`), unrelated to this task.
