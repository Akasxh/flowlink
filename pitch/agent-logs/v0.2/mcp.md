# MCP server (v0.2)

Implemented FlowLink's hosted MCP endpoint at `POST/GET /mcp` per JSON-RPC
2.0 + MCP transport spec, no SDK dependency. Three new files in
`/home/akash/PROJECTS/flowlink/src`:

1. `lib/mcp.ts` (203 LOC, under the 250 cap) — protocol core. Exposes
   `handleJsonRpc(message, ctx)` returning `JsonRpcResponse | null`
   (null = notification, no reply). Handles `initialize`,
   `notifications/initialized`, `tools/list`, `tools/call`. Tool catalogue
   matches `public/.well-known/mcp.json` verbatim and ships `inputSchema`
   for each. Error codes are spec-correct: `-32600`, `-32601`, `-32602`,
   `-32603`, `-32700`.

2. `lib/mcp-tools.ts` — six tool handlers wired straight into
   `lib/compliance.check`, `lib/prisma`, `lib/hsp`, `lib/chain`. The
   `pay_invoice` flow mirrors the v1 route's compliance preflight,
   `updateMany` lock acquisition, mandate creation, and graceful HSP
   degradation. Errors are returned as MCP `isError: true` envelopes.

3. `app/mcp/route.ts` — Next.js App Router handler. GET emits the SSE
   `endpoint` event plus 15 s heartbeats; POST returns inline JSON or an
   `event: message` SSE frame depending on `Accept`. Auth is `authenticate()`
   from `lib/auth/middleware`, returning 401 Problem+JSON.

Validation: `pnpm typecheck` clean, `pnpm test` 47/47 pass (11 new MCP
tests). Live smoke against `localhost:3001` confirmed 401 without Bearer,
correct `initialize` shape, all six tools enumerated, Tornado-Cash
fallback hit on `check_sanctions`, and `-32601` on unknown tools.
