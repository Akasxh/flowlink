# Adversarial Review — agent-everywhere rollout

**Reviewer:** Adversarial Reviewer (round 2)
**Date:** 2026-04-22
**Verdict:** REVISE — 2 P1 issues block "done"

---

## Pass (green-light items)

- **dashboard.md + admin.md skill specs** are solid. Cross-references are correct (`./dashboard.md` ↔ `./admin.md` ↔ `./errors.md`). Auth section accurately warns about v0.3 migration. Response schemas match the actual route handlers. No raw key hashes leak from `list_api_keys` — the projection at `mcp-tools.ts:436-445` explicitly excludes `keyHash`.
- **Middleware Link headers** (`src/middleware.ts`) are correctly scoped. Matcher restricts to `/` and `/dashboard/:path*`; the `if` guards prevent stamping `/api/admin/*` JSON responses. RFC 8288 syntax is correct (comma-separated link-values, semicolon params).
- **Dashboard layout.tsx** emits matching `<link rel="alternate">` tags via both `metadata.alternates` and raw `<link>` elements, with a `describedby` fallback for the Next metadata API gap. Consistent with what middleware emits as headers.
- **Observability response shape** in `access-log.ts:34-44` matches what `dashboard.md:79-95` documents (field names, types, semantics).
- **Admin route auth gate** is implemented correctly. Timing-safe comparison is absent (string `!==`), but at v0.2 dev-only shared-secret scope this is acceptable. Defence-in-depth ownership check on DELETE is present (`keys/route.ts:176-177`).
- **OpenAPI admin schemas** registered with correct `adminToken` security scheme at `openapi.ts:58-62`, separate from bearer auth. Good separation.

## Concerns (P1) — must fix

### P1-1: `mcp.json` lists 6 tools but the live MCP server exposes 10

`public/.well-known/mcp.json` (the static discovery manifest) declares 6 tools: `create_invoice`, `get_invoice`, `pay_invoice`, `check_sanctions`, `get_receipt`, `get_reputation`. The actual `tools/list` response from the MCP server at `/mcp` returns 10 tools — adding `list_api_keys`, `mint_api_key`, `revoke_api_key`, `query_observability` (see `mcp.ts:142-194`).

An agent that reads `mcp.json` for pre-flight planning will not know admin tools exist. An agent that connects to the SSE endpoint will discover tools that `mcp.json` didn't advertise. This is a **discoverability contract violation** — the static manifest and the live server MUST agree on what's available.

**File:** `public/.well-known/mcp.json` (entire file — only has 6 tools)
**File:** `src/lib/mcp.ts:74-195` (10 tools in `MCP_TOOLS`)

**Fix:** Add the 4 admin tools to `mcp.json` with an `"admin": true` annotation matching the `McpTool` type in `mcp.ts`. Alternatively, if admin tools should NOT be publicly discoverable in the static manifest, add a comment in `mcp.ts` explaining the intentional split and filter `admin: true` tools from the `tools/list` response unless the caller has admin scope.

### P1-2: MCP admin tools bypass the `X-Admin-Token` gate entirely

The HTTP routes at `/api/admin/keys` and `/api/admin/observability` check `X-Admin-Token` against `process.env.ADMIN_TOKEN` (`keys/route.ts:46-78`, `observability/route.ts:18-38`). The MCP equivalents in `mcp-tools.ts:419-536` have **zero admin auth checks**. They call `ensureAdminUserId()` (which just upserts a user row) but never verify the caller holds admin privileges.

The MCP route authenticates via SIWE bearer (`mcp/route.ts:41-43`), meaning **any authenticated agent** — including one holding only a `receipt:read` scoped key — can call `mint_api_key` via MCP and escalate to full `pay:execute` scope. This is a privilege escalation path.

The comment at `mcp-tools.ts:397-398` says "flagged `admin: true` in the catalogue so clients can surface the dev-only nature" — but a flag is advisory, not enforcement. The server must reject, not hope the client self-censors.

**File:** `src/lib/mcp-tools.ts:419-536` (no admin gate)
**File:** `src/lib/mcp-tools.ts:397-398` (comment that is the only "guard")
**File:** `src/app/mcp/route.ts:41-43` (only bearer auth, no scope check)

**Fix:** Add a scope check in `handleJsonRpc` (or in each admin handler) that rejects calls to `admin: true` tools unless the principal holds an `admin:*` scope. Until v0.3 scoped sessions exist, either: (a) require the caller to also send `X-Admin-Token` as a tool argument, or (b) remove admin tools from the MCP surface entirely and require the HTTP route.

## Nitpicks (P2)

### P2-1: Sitemap deviates from architect schema

The architect spec (`00-architect.md:54-84`) defines entries with fields `url`, `kind`, `human_alternate`, `agent_alternate`. Optional: `skill_refs`, `updated_at`, `auth`. The shipped `sitemap-agent.json` adds `summary` (not in spec) and a `categories` top-level array (not in spec). The `kind` taxonomy adds `api` and `human-page` beyond the architect's six (`skill`, `page-spec`, `manifest`, `signal`, `policy`, `index`). `policy` and `index` kinds from the spec are absent.

Not blocking — the shipped schema is arguably better (more complete). But the deviation from the binding spec should be documented.

### P2-2: Duplicate entries in sitemap-agent.json

`/dashboard/agents` appears twice: once as `kind: "human-page"` (line 192) and once as `kind: "page-spec"` (line 191). Same for `/dashboard/keys`. The architect spec says "Every URL on the site MUST belong to exactly one [category]." Having both is intentionally modeling two facets of the same URL, but it breaks the uniqueness constraint.

### P2-3: `/.well-known/agent-sitemap.md` classified as `signal`

`sitemap-agent.json:207` classifies `/.well-known/agent-sitemap.md` as `kind: "signal"`. The architect spec puts it under `index`. A human-readable sitemap companion is not a "signal" (crypto/verification material).

### P2-4: llms.txt does not list admin.md or dashboard.md skills

`public/llms.txt:15-19` lists 5 skills (invoice, pay, compliance, receipt, reputation). The two new skills are missing. An agent following the llms.txt → skills discovery path will not find admin or dashboard.

### P2-5: No `/.agent/page/` files exist

The architect spec proposed `/.agent/page/dashboard/keys.md` and `/.agent/page/dashboard/agents.md` as page-spec siblings. None were created. The sitemap lists page-spec entries pointing at `/skills/dashboard.md` instead. This works but diverges from the spec's URL convention.

### P2-6: Discoverability triple-redundancy

`/llms.txt`, `/sitemap-agent.json`, and `/.well-known/agent-sitemap.md` all serve as entry-point indexes. No deprecation path is documented. This is fine for now — llms.txt is the emerging convention, sitemap-agent.json is the machine-readable canonical, agent-sitemap.md is the human companion. But a note on which is authoritative would reduce confusion.

### P2-7: `sitemap-crawler.sh` test does not exist

The task description says round 2 includes a "page-discovery sitemap-crawler test at `tests/sitemap-crawler.sh`." The file does not exist on disk. Only `tests/curl-agent.sh` is present. No CI check validates that new routes get added to the sitemap.

## Recommended fix order

1. **P1-2 first** — the privilege escalation via MCP admin tools. Either gate them behind scope checks or remove them from the MCP tool surface. This is a security issue.
2. **P1-1 second** — sync `mcp.json` with the live MCP tool catalogue. Agents relying on the static manifest will misunderstand what's available.
3. **P2-4 third** — add `admin.md` and `dashboard.md` to `llms.txt`. Trivial fix, high discoverability impact.
