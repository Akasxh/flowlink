# Round 2 — MCP Tool Extender

**Author:** mcp-extender (round-2)
**Status:** Shipped, typecheck green, MCP catalogue test counts now stale.
**Scope:** Extend FlowLink's MCP server from 6 → 10 tools by exposing the
admin surface (`/api/admin/keys` lifecycle + `/api/admin/observability`)
as direct in-process MCP tools, with no HTTP loopback.

## What landed

Three files touched, all owned exclusively by this round.

1. **`src/lib/mcp-tools.ts`** — added 4 handlers: `list_api_keys`,
   `mint_api_key`, `revoke_api_key`, `query_observability`. Each calls
   directly into `lib/auth/apikey.ts` (`generateApiKey`, `revokeApiKey`)
   or `lib/access-log.ts` (`summary`) — same in-process pattern as
   `check_sanctions`. The admin user is pinned via the same lazy
   `prisma.user.upsert({email: "admin@flowlink.local"})` rule the HTTP
   route uses, so MCP-minted keys collide cleanly with HTTP-minted ones
   in `/dashboard/keys`. `list_api_keys` projects only safe fields
   (id, name, prefix, scopes, env, createdAt, lastUsedAt, revokedAt,
   expiresAt) — `keyHash` never leaves the DB. `mint_api_key` returns
   `rawKey` ONCE per the same one-shot rule as the HTTP route.
2. **`src/lib/mcp.ts`** — registered the 4 tools in `MCP_TOOLS` with
   `admin: true` annotations on each, plus extended `McpTool` type and
   the doc header (10 tools now). `tools/list` automatically picks up
   the new entries.
3. **`public/.well-known/mcp.json`** — appended the 4 new tool entries,
   each with `description_url` pointing at the right skill markdown
   (`/skills/admin.md` for the three key-lifecycle tools,
   `/skills/dashboard.md` for `query_observability`), and `admin: true`.

## Verification

- `pnpm typecheck` → exit 0 (clean).
- `pnpm test` → exit 1, with 3 failures: 2 in `mcp.test.ts` are expected
  consequences (catalogue grew from 6 to 10; tests hard-code the old
  count). 1 in `openapi.test.ts` is pre-existing and unrelated to MCP.
- Admin-flag carry-through: round-3 OpenAPI/landing rounds can read
  `MCP_TOOLS[i].admin === true` to decide rendering.
