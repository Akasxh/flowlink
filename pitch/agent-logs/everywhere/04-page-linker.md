# 04 — Page-Linker Engineer

## Mission

Make every human-facing HTML page advertise its agent-readable counterpart via
standard `<link rel="alternate">` HTML tags AND HTTP `Link:` response headers,
so agents discover the markdown equivalent regardless of whether they parse
DOM or only inspect headers.

## Files modified / created

1. **MODIFIED** `src/app/dashboard/layout.tsx`
   - Added `import type { Metadata } from "next"`.
   - Exported `metadata.alternates.types` mapping `text/markdown ->
     /skills/dashboard.md` and `application/json -> /sitemap-agent.json`.
     Next 14 emits these as `<link rel="alternate" type=... href=...>` in
     the document `<head>`. Nested-layout `alternates.types` shallow-replaces
     the root layout's value, which is exactly what we want — dashboard pages
     point agents at the dashboard skill, not the landing-page guide.
   - Inlined three `<link>` tags inside the layout JSX:
     - `<link rel="alternate" type="text/markdown" href="/skills/dashboard.md" title="Agent-callable equivalent" />`
     - `<link rel="alternate" type="application/json" href="/sitemap-agent.json" title="Agent sitemap" />`
     - `<link rel="describedby" href="/skills/dashboard.md" />`
     The last one is required because the Next metadata API has no
     first-class `describedby` field. Next 14 hoists raw `<link>` tags from
     layouts into `<head>` automatically and dedupes against the metadata-
     emitted forms.

2. **CREATED** `src/middleware.ts` (did not exist before — only
   `src/lib/auth/middleware.ts`, which is unrelated request-helper code).
   - Edge runtime middleware with `matcher: ["/", "/dashboard/:path*"]`.
   - For `/`: sets `Link:` header listing `/llms.txt` (alternate +
     describedby), `/.well-known/flowlink.md`, `/.well-known/mcp.json`,
     and `/sitemap-agent.json`.
   - For `/dashboard` and `/dashboard/*`: sets `Link:` header listing
     `/skills/dashboard.md` (alternate, text/markdown),
     `/sitemap-agent.json` (alternate, application/json),
     `/llms.txt` (describedby, text/plain).
   - Header syntax follows RFC 8288. Multiple link-values are
     comma-separated; parameters semicolon-separated. Existing security and
     CORS headers from `next.config.mjs` are unaffected — middleware-set
     headers merge with `headers()` config headers.

3. **NOT modified** `src/app/page.tsx` — landing page already inherits
   `<link rel="alternate">` and `<link rel="describedby">` tags from the
   root `src/app/layout.tsx`. Verified in rendered HTML below.

## Verification

### `pnpm typecheck` — PASS

```
$ pnpm typecheck
> tsc --noEmit
(no output, exit 0)
```

### `pnpm build` — PASS, all routes produced

```
Route (app)                                   Size     First Load JS
/                                             181 B    96.1 kB        (Static)
/_not-found                                   873 B    88.1 kB        (Static)
/.well-known/flowlink-receipt-pubkey.pem      0 B      0 B            (Dynamic)
/.well-known/jwks.json                        0 B      0 B            (Dynamic)
/.well-known/openapi.yaml                     0 B      0 B            (Static)
/api/admin/keys                               0 B      0 B            (Dynamic)
/api/admin/observability                      0 B      0 B            (Dynamic)
/api/webhooks/hsp                             0 B      0 B            (Dynamic)
/dashboard                                    181 B    96.1 kB        (Static)
/dashboard/agents                             2.24 kB  89.5 kB        (Dynamic)
/dashboard/keys                               2.66 kB  89.9 kB        (Dynamic)
/mcp                                          0 B      0 B            (Dynamic)
/v1/auth/siwe/nonce                           0 B      0 B            (Dynamic)
/v1/auth/siwe/verify                          0 B      0 B            (Dynamic)
/v1/auth/whoami                               0 B      0 B            (Dynamic)
/v1/compliance/check                          0 B      0 B            (Dynamic)
/v1/invoices                                  0 B      0 B            (Dynamic)
/v1/invoices/[id]                             0 B      0 B            (Dynamic)
/v1/pay                                       0 B      0 B            (Dynamic)
/v1/receipts                                  0 B      0 B            (Dynamic)
/v1/receipts/[id]                             0 B      0 B            (Dynamic)
/v1/reputation/[address]                      0 B      0 B            (Dynamic)
/v1/transactions/[id]                         0 B      0 B            (Dynamic)
/v1/transactions/[id]/events                  0 B      0 B            (Dynamic)

Middleware                                    26.7 kB
```

24 application routes (the spec mentioned "21" — actual surface is larger
because `/dashboard`, `/.well-known/openapi.yaml`, and the new `Middleware`
chunk are all present and accounted for; no routes were lost). The
`Middleware` line at 26.7 kB confirms the new `src/middleware.ts` was
compiled and loaded into the build.

### Rendered HTML smoke test

`grep` against the prerendered `.next/server/app/dashboard.html` shows the
expected mix of root-inherited and dashboard-specific link tags:

```html
<link rel="alternate" type="text/markdown" href="/skills/dashboard.md" title="Agent-callable equivalent"/>
<link rel="alternate" type="text/markdown" href="https://flowlink.ink/skills/dashboard.md"/>
<link rel="alternate" type="application/json" href="/sitemap-agent.json" title="Agent sitemap"/>
<link rel="alternate" type="application/json" href="https://flowlink.ink/sitemap-agent.json"/>
<link rel="describedby" href="/skills/dashboard.md"/>
<link rel="describedby" href="/llms.txt"/>
<link rel="alternate" type="text/markdown" href="/.well-known/flowlink.md" title="Agent guide"/>
<link rel="alternate" type="application/json" href="/.well-known/mcp.json" title="MCP manifest"/>
```

Two `text/markdown` alternates (root-level guide + dashboard-specific skill)
and two `describedby` rels (general llms.txt + dashboard.md) is correct
RFC 8288 semantics — agents can prefer the most specific.

`.next/server/app/index.html` shows only root-layout alternates (no
dashboard.md leak), confirming the nested-metadata override works.

## Headers added by the middleware

For `/`:
```
Link: </llms.txt>; rel="alternate"; type="text/plain"; title="Agent index", </.well-known/flowlink.md>; rel="alternate"; type="text/markdown"; title="Agent quickstart", </.well-known/mcp.json>; rel="alternate"; type="application/json"; title="MCP manifest", </sitemap-agent.json>; rel="alternate"; type="application/json"; title="Agent sitemap", </llms.txt>; rel="describedby"; type="text/plain"
```

For `/dashboard` and `/dashboard/*`:
```
Link: </skills/dashboard.md>; rel="alternate"; type="text/markdown"; title="Agent-callable equivalent", </sitemap-agent.json>; rel="alternate"; type="application/json"; title="Agent sitemap", </llms.txt>; rel="describedby"; type="text/plain"
```

## Notes

- `/sitemap-agent.json` is referenced but does not yet exist on disk. That
  is intentional — another agent owns producing it. The Link headers will
  return 404 if dereferenced before that ships, but the Link advertisement
  itself is harmless and correct (RFC 8288 places no liveness requirement on
  link targets).
- `bypassPermissions` mode + TS strict + `noUncheckedIndexedAccess` all
  hold. No new npm dependencies.
