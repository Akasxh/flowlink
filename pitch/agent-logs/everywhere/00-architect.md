# Agent-Everywhere Architecture — FlowLink

**Author:** Architect (round-0)
**Status:** Binding spec for round-1 implementers
**Scope:** Make the *whole* flowlink.ink agent-readable, not just `/v1/*`.

## 1. Problem

Only `/v1/*` is agent-readable today (`/llms.txt`, `/skills/*.md`,
`/.well-known/{flowlink.md,mcp.json,jwks.json,...pem}`). Landing, dashboard
(`src/app/dashboard/{keys,agents}`), admin (`src/app/api/admin/*`), and
future legal/pricing pages have no agent counterpart. An agent landing on
`/dashboard/keys` sees a React shell and bounces. Fix: one schema, one
sitemap, one linking rule.

## 2. Artifact taxonomy

Six categories. Every URL on the site MUST belong to exactly one.

| kind | purpose | location convention | example |
|---|---|---|---|
| `skill` | Callable API surface, one markdown per capability | `/skills/<name>.md` | `/skills/invoice.md` |
| `page-spec` | Agent-side mirror of a human-facing page; describes intent + the API path the agent should use instead | `/.agent/page/<path>.md` | `/.agent/page/dashboard/keys.md` |
| `manifest` | Machine-discovery documents (MCP, OpenAPI, robots, sitemaps) | `/.well-known/*` and `/sitemap-agent.json` | `/.well-known/mcp.json`, `/.well-known/openapi.yaml` |
| `signal` | Public crypto / verification material | `/.well-known/*.{pem,json}` | `/.well-known/jwks.json`, `/.well-known/flowlink-receipt-pubkey.pem` |
| `policy` | Legal, security, privacy, abuse contact | `/.well-known/security.txt`, `/policies/<slug>.md` | `/.well-known/security.txt`, `/policies/terms.md` |
| `index` | Table-of-contents documents that point at everything else | site root | `/llms.txt`, `/.well-known/agent-sitemap.md` |

`page-spec` is the new category — humans get React, agents get a `.md`
sibling at a predictable path.

## 3. Naming & URL conventions

- **`/skills/*.md`** — already canonical. Keep it. One file per capability,
  not per endpoint. Endpoint detail belongs in OpenAPI; intent + worked
  example belongs in the skill.
- **`/.well-known/*`** — RFC 8615. Reserved for discovery, manifests, crypto
  signals, and policy. Never put callable surface here.
- **`/.agent/page/*.md`** — proposal. Mirrors the human URL tree:
  `/dashboard/keys` → `/.agent/page/dashboard/keys.md`. The `.agent`
  prefix keeps it out of the React route tree and is short enough for
  `Link:` headers. Rejected: `/agent/*` (collides with `/dashboard/agents`);
  `?format=md` (cache + crawler hazards).
- **`/sitemap-agent.json`** — machine sitemap. Sibling to the standard
  `/sitemap.xml`. JSON because every agent runtime parses JSON natively;
  XML for sitemap.xml stays for SEO crawlers.
- **`/.well-known/agent-sitemap.md`** — human-readable mirror of the JSON
  sitemap, so a developer eyeballing the discovery surface can navigate it.
- **`/.well-known/security.txt`** — RFC 9116 contact + disclosure policy.
  Mandatory.

## 4. `/sitemap-agent.json` schema

```json
{
  "$schema": "https://flowlink.ink/.well-known/agent-sitemap.schema.json",
  "version": "1",
  "generated_at": "2026-04-22T00:00:00Z",
  "site": "https://flowlink.ink",
  "entries": [
    { "url": "/", "kind": "index", "human_alternate": "/", "agent_alternate": "/llms.txt" },
    { "url": "/skills/invoice.md", "kind": "skill", "human_alternate": null, "agent_alternate": "/skills/invoice.md" },
    { "url": "/skills/pay.md", "kind": "skill", "human_alternate": null, "agent_alternate": "/skills/pay.md" },
    { "url": "/dashboard/keys", "kind": "page-spec",
      "human_alternate": "/dashboard/keys",
      "agent_alternate": "/.agent/page/dashboard/keys.md",
      "skill_refs": ["/skills/admin.md", "/skills/dashboard.md"] },
    { "url": "/dashboard/agents", "kind": "page-spec",
      "human_alternate": "/dashboard/agents",
      "agent_alternate": "/.agent/page/dashboard/agents.md",
      "skill_refs": ["/skills/dashboard.md"] },
    { "url": "/.well-known/mcp.json", "kind": "manifest",
      "human_alternate": null, "agent_alternate": "/.well-known/mcp.json" },
    { "url": "/.well-known/openapi.yaml", "kind": "manifest",
      "human_alternate": null, "agent_alternate": "/.well-known/openapi.yaml" },
    { "url": "/.well-known/jwks.json", "kind": "signal",
      "human_alternate": null, "agent_alternate": "/.well-known/jwks.json" },
    { "url": "/.well-known/flowlink-receipt-pubkey.pem", "kind": "signal",
      "human_alternate": null, "agent_alternate": "/.well-known/flowlink-receipt-pubkey.pem" },
    { "url": "/.well-known/security.txt", "kind": "policy",
      "human_alternate": null, "agent_alternate": "/.well-known/security.txt" }
  ]
}
```

Required fields per entry: `url`, `kind`, `human_alternate`, `agent_alternate`.
Optional: `skill_refs` (array of skill paths the page-spec depends on),
`updated_at`, `auth` (`"public" | "wallet" | "api-key" | "admin"`).

## 5. Linking discipline

Two reciprocal rules, no exceptions:

1. **Every human page** (any `src/app/**/page.tsx`) MUST emit:
   - `<link rel="alternate" type="text/markdown" href="/.agent/page/<same-path>.md">`
     in the React `<head>`.
   - HTTP `Link: </.agent/page/<same-path>.md>; rel="alternate"; type="text/markdown"`
     header set in `src/middleware.ts` for the matching path.
2. **Every agent page** (any `/.agent/**` or `/skills/**` or `/.well-known/**`
   that has a human counterpart) MUST emit:
   - HTTP `Link: <human-url>; rel="canonical"`.
   - First line of the markdown: `> Human page: https://flowlink.ink/<path>`.

The reciprocal `Link` headers let agents discover the alternate by issuing
a single `HEAD` request — no HTML parsing required. The `<link>` tag in
HTML is the fallback for clients that already parsed the page.

## 6. Round-1 assignments

### Skill Author A — `/public/skills/dashboard.md`
- Build: one markdown covering `/dashboard/keys` + `/dashboard/agents`
  from an agent's view ("to mint a key from a script, POST
  `/api/admin/keys`; for observability, GET `/api/admin/observability`").
  Curl recipes for both. Cite `/skills/admin.md` for endpoint detail.
- Owns: `/home/akash/PROJECTS/flowlink/public/skills/dashboard.md`.
- Do NOT touch: other `/skills/*.md`, any `src/app/**`, sitemap, middleware.

### Skill Author B — `/public/skills/admin.md`
- Build: callable surface for `/api/admin/keys` + `/api/admin/observability`.
  Document the `X-Admin-Token` gate, mint/list/revoke flows, one-shot
  `rawKey` rule, `503 admin disabled` fallback. Style mirrors
  `/skills/invoice.md`. Note the v0.3 per-user-session migration.
- Owns: `/home/akash/PROJECTS/flowlink/public/skills/admin.md`.
- Do NOT touch: `/v1/*` skills, route handlers, sitemap, middleware.

### Sitemap Engineer — `/public/sitemap-agent.json` + `agent-sitemap.md`
- Build: JSON sitemap exactly per §4, plus a human-readable mirror at
  `/.well-known/agent-sitemap.md` (same entries as a hyperlinked table).
  Include all six skills, both page-specs (flag `"draft": true` until
  written), all `.well-known/*`, `/llms.txt`.
- Owns: `/home/akash/PROJECTS/flowlink/public/sitemap-agent.json`,
  `/home/akash/PROJECTS/flowlink/public/.well-known/agent-sitemap.md`.
- Do NOT touch: any `src/**`, `/skills/*.md`, middleware.

### Page-Linker Engineer — `<link>` tags + `Link:` headers
- Build: add `<link rel="alternate" type="text/markdown" href="...">` to
  every `src/app/dashboard/**/page.tsx` (`keys/page.tsx`, `agents/page.tsx`,
  dashboard root `page.tsx`). Create `src/middleware.ts` to attach the
  matching `Link:` header on `/dashboard/**`. Matcher must be precise —
  no blanket apply to `/api/**` or `/v1/**`.
- Owns: edits to `src/app/dashboard/**/page.tsx` and `src/middleware.ts`.
- Do NOT touch: `/skills/*.md`, sitemap, `/api/**` handlers, `.well-known/*`.

## 7. Out of scope for round-1

`/policies/*.md`, `/.well-known/security.txt`, `/.well-known/openapi.yaml`,
the sitemap JSON schema, and `.agent/page/dashboard/*.md` content itself —
round-2 picks those up once linking + sitemap infra is live.
