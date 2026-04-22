# FlowLink

**Agent-native compliance-first payment layer on HashKey Chain. Markdown is the API.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![HashKey Chain](https://img.shields.io/badge/HashKey-Chain%20133-0d7a7a)](https://hashkeychain-testnet-explorer.alt.technology)

FlowLink lets AI agents create crypto invoices and settle them in stablecoins on HashKey Chain, with OFAC
screening and velocity limits inlined at the call site. Every successful payment emits an ed25519-signed
receipt that any third party can verify.

The signature move: **the website is the SDK**. A fresh Claude Sonnet, given only
`https://flowlink.ink/llms.txt`, can discover every capability and complete an invoice → pay → receipt flow
with only `fetch()` as a tool. No SDK. No API keys for discovery. No docs to scrape.

---

## Status

This is a ground-up rewrite of an earlier FlowLink prototype, focused on two things the original missed:

1. **An agent-native public surface.** 5 static files (`llms.txt`, `skills/*.md`, `.well-known/mcp.json`) that document the entire API for any LLM.
2. **Modular layers.** Each `lib/*` module is independently testable. If HSP is down, compliance still works. If the OFAC upstream is down, we fail closed — not silently-pass.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the module layering and the rule that makes it hold:
no `lib/*` module imports another `lib/*` module except through explicit, narrow interfaces.

---

## Ship status by layer

| Layer | Module | Status |
|---|---|---|
| 1 | Scaffold + static discovery (`llms.txt`, skills, `mcp.json`, landing) | shipping |
| 2 | `lib/errors` · `lib/idempotency` · `lib/ratelimit` | in progress |
| 3 | `lib/auth/{siwe,jwt,apikey}` | in progress |
| 4 | `lib/compliance` (OFAC fail-closed + velocity) | in progress |
| 5 | `lib/receipts` (ed25519 signing) | in progress |
| 6 | `lib/hsp` (graceful degradation) | in progress |
| 7 | Prisma schema + migrations | in progress |
| 8 | `/v1/*` routes assembled from modules | in progress |
| 9 | Curl acceptance test + fresh-Sonnet gate | in progress |

Every layer must pass its own tests before the next lands. If you pull at any commit, the layers that
exist work; the ones that don't aren't exposed.

---

## Agent-native surface (live once Layer 1 deploys)

| Path | Purpose |
|---|---|
| `/llms.txt` | The single entry point. Every agent reads this first. |
| `/skills/invoice.md` | Create / read / cancel invoices |
| `/skills/pay.md` | Settle an invoice via HSP mandate + OFAC check |
| `/skills/compliance.md` | OFAC + velocity screen (fail-closed) |
| `/skills/receipt.md` | Fetch ed25519-signed settlement proof |
| `/skills/reputation.md` | Query portable reputation score |
| `/skills/errors.md` | Full RFC 9457 Problem+JSON error catalogue |
| `/.well-known/flowlink.md` | Narrative quickstart (~400 words) |
| `/.well-known/mcp.json` | MCP server manifest |
| `/.well-known/openapi.yaml` | OpenAPI 3.1 spec (auto-generated — Layer 8) |
| `/robots.txt` | AI crawlers explicitly welcomed |

---

## Local dev

```bash
pnpm install
cp .env.example .env.local         # generate signing keys into this file
pnpm db:push                       # provisions SQLite dev db
pnpm dev                           # http://localhost:3000
```

Verify the agent surface:

```bash
curl http://localhost:3000/llms.txt
curl http://localhost:3000/skills/pay.md
curl http://localhost:3000/.well-known/mcp.json | jq
```

---

## Design invariants

These are not suggestions — they're enforced by code review and CI lints.

- **No skill file exceeds 10 KB.** Prose belongs in `.well-known/flowlink.md`, not in skills.
- **Every error carries `code` and `agent_action`.** `{error: "..."}` strings are rejected in review.
- **OFAC check fails closed.** Under any upstream error, `/v1/pay` is blocked. Compliance is not a checkbox.
- **Every write endpoint requires `Idempotency-Key`.** Duplicate keys replay the original response byte-for-byte.
- **Every `lib/*` module is independently testable.** If module A requires module B to run its tests,
  the boundary is broken.
- **HSP integration degrades gracefully.** `lib/hsp.isConfigured()` returns false → `/v1/pay` returns a
  diagnostic error, never crashes. Compliance, receipts, invoices all still work.

---

## Security / compliance posture

This is the reason FlowLink exists — not an afterthought.

- **OFAC SDN screening** on every payment via `api.ofac.dev` + a hardcoded fallback list of known-bad
  addresses (Tornado Cash, Lazarus). **Fails closed**: network error ⇒ `compliance_upstream_unavailable`
  (HTTP 503), payment blocked.
- **24h velocity ceiling** per address, enforced in `lib/compliance`. Configurable via `COMPLIANCE_*`.
- **Ed25519-signed receipts.** Public key at `/.well-known/flowlink-receipt-pubkey.pem`. Verification is
  pure math — any language, no FlowLink dependency.
- **HMAC-signed HSP webhooks.** Replay-protected via ±5 minute timestamp window.
- **CSP without `unsafe-inline` / `unsafe-eval`.** No bundled JS executes untrusted input.
- **Idempotency on every write.** Prevents double-spend from concurrent retries.
- **JWT signing keys rotated monthly.** Old keys remain verifiable via JWKS history at
  `/.well-known/jwks.json`.
- **No secrets in source.** `.env.example` is the manifest; `.env*` is gitignored.

---

## Not in v1 (intentional cuts)

These lived in an earlier prototype. Cut for simplicity. Revisit when a real user asks.

- Google OAuth + email/password human auth (SIWE + API keys only in v1)
- Managed wallets with encrypted mnemonics
- Multi-Pay HSP mandates (Single-Pay only)
- Payroll / Compliance Vaults / Reports dashboards
- Agent rules engine (scheduled / conditional payments)
- `FlowLinkPayments.sol` custom settlement contract (HSP does it)
- Travel Rule submission, EAS attestations, ERC-8004 agent registry

---

## Pitch + real-agent evidence

[`pitch/`](./pitch/) contains the slides, screenshots, pitch deck, and **22 real Claude agent
transcripts** from 5 iterations of testing. Open `pitch/comparison.html` locally to see the
side-by-side replay of agent-with-FlowLink vs agent-with-Playwright-only. Every number in those
slides comes from a real run.

## Hackathon note

FlowLink was first built for the HashKey On-Chain Horizon Hackathon 2026 on the PayFi and AI tracks. The
earlier prototype ([AkakpoErnest/FlowLink](https://github.com/AkakpoErnest/FlowLink)) proved the HSP
integration works. This repo is the clean agent-native rewrite.

---

## License

MIT — see [`LICENSE`](./LICENSE).
