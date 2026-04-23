# 07 — Page-Discovery Test Author

## What I built

- **`tests/sitemap-crawler.sh`** — pure bash + curl + jq, no npm deps. Reads
  `/sitemap-agent.json` from a live server, walks all 39 entries, asserts
  three contracts per entry: (1) the URL resolves, (2) any `agent_alternate`
  returns 200, (3) every `kind: human-page` carries an RFC 8288 `Link:`
  header with `rel="alternate"; type="text/markdown"` pointing at its
  `agent_alternate`. Idempotent, exits 1 on failure with a per-entry detail
  block.
- **`scripts/run-sitemap-test.mjs`** — node:* only wrapper. `--managed`
  spawns `pnpm dev`, polls `/llms.txt` for readiness (timeout 120 s), runs
  the crawler, tears the dev server down. `--external` (default if
  `FLOWLINK_URL` is set) skips the spawn and just probes.

## CI invocation

```yaml
- run: node scripts/run-sitemap-test.mjs --managed
# or against a deployed preview:
- run: FLOWLINK_URL=https://flowlink-preview.vercel.app node scripts/run-sitemap-test.mjs
```

## Edge cases handled

- **Auth-gated endpoints** — 200/401/403/405 all count as "reachable"; only
  the 200 path forces a happy-path response.
- **Missing `agent_alternate`** — alternate + Link-header checks skipped, main
  URL still verified.
- **Template URLs** like `/v1/invoices/[id]` — marked TEMPLATE and skipped.
- **The `/mcp` SSE endpoint** holds the connection open; we use `--max-time
  3` and accept curl exit 28 (timeout) as proof of life.
- **Multi-value Link headers** — when several link-values are comma-joined,
  we isolate the segment naming `agent_alternate` and enforce
  `type="text/markdown"` on that segment, not the whole line.

## Live findings

Against a running dev server: 32/39 pass, 5 templates skipped, 2 failures
(`/api/admin/keys` and `/api/admin/observability` return 500 on
unauthenticated GET instead of 401 — real bug in the admin guard).

## v0.3

Mint fixture ids so template URLs get tested, header-check 401 responses
too, JUnit-XML output for CI dashboards.
