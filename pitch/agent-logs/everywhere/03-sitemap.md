# 03 — Sitemap Engineer

Built the agent-readable sitemap at `public/sitemap-agent.json` and its human companion at `public/.well-known/agent-sitemap.md`, then linked the JSON manifest from `public/llms.txt` under "Start here".

**39 entries** across the six categories declared in the schema:

- **api: 16** — every `/v1/*` route discovered in `src/app/v1/**`, both admin endpoints, the HSP webhook, and the MCP SSE endpoint. Included the previously undocumented `/v1/auth/whoami` since the route file exists.
- **skill: 8** — the six in-tree skill specs plus the parallel-authored `dashboard.md` and `admin.md` (will land before integration, per the brief).
- **manifest: 5** — `flowlink.md`, `mcp.json`, `openapi.yaml` (v0.2), `llms.txt`, and the new `sitemap-agent.json` itself.
- **human-page: 4** — landing plus the three dashboard surfaces.
- **signal: 4** — `robots.txt`, the receipt pubkey PEM, JWKS, and the agent-sitemap markdown companion.
- **page-spec: 2** — placeholder spec siblings for the two interactive dashboard pages so agents know they have a structured equivalent.

**Categorization choices.** I split `api` (live request/response endpoints, including admin and webhooks) from `manifest` (static discovery indexes that an agent reads once at boot) and from `signal` (cryptographic / policy artefacts whose value is the bytes themselves, not a request flow). `page-spec` is reserved for agent-flavoured siblings of human pages — currently only the two dashboard pages have these — to keep that distinction explicit rather than collapsing them into `skill`. Entries are sorted by `kind` then `url` for deterministic diffs, and every entry carries `agent_alternate` and `human_alternate` (null where no sibling exists) so a crawler can hop between flavours without a second lookup. The `dashboard` and `admin` skill files are listed even though they are still being authored in parallel; the brief explicitly requested this so the sitemap is correct on landing.
