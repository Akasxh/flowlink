# FlowLink agent-sitemap

Human-readable companion to [`/sitemap-agent.json`](/sitemap-agent.json). Same content, grouped by `kind`.

This sitemap exists so an autonomous agent crawling FlowLink does not have to guess what URLs are agent-relevant. Every URL on the site that a reasoning agent might want to fetch — skill specs, manifests, signed signals, page descriptions, human pages, and live API endpoints — is enumerated here with a one-line summary and, where applicable, the address of the agent-flavoured or human-flavoured sibling. Entries are sorted by `kind`, then by `url`, so diffs are deterministic and reviewers can see what was added or removed at a glance.

Generated: `2026-04-22T00:00:00Z` (schema version 1.0.0)

## skill

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/skills/admin.md` | Admin operations: API key lifecycle and observability aggregates | — | `/dashboard/keys` |
| `/skills/compliance.md` | Pre-flight OFAC + velocity screening (fail-closed) before settlement | — | — |
| `/skills/dashboard.md` | Programmatic equivalents of the human dashboard surfaces | — | `/dashboard` |
| `/skills/errors.md` | RFC 9457 Problem+JSON error catalogue with codes and agent_action hints | — | — |
| `/skills/invoice.md` | Create, read, and cancel invoices | — | — |
| `/skills/pay.md` | Settle invoices via HSP Single-Pay mandate on HashKey Chain (id 133) | — | — |
| `/skills/receipt.md` | Fetch ed25519-signed cryptographic proof of settlement | — | — |
| `/skills/reputation.md` | Read counterparty trust score derived from on-chain history | — | — |

## manifest

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/.well-known/flowlink.md` | Agent quickstart: pay an invoice on HashKey testnet in under 60 seconds | — | — |
| `/.well-known/mcp.json` | MCP server manifest advertising FlowLink skills as remote tools | — | — |
| `/.well-known/openapi.yaml` | OpenAPI 3.1 specification for all `/v1/*` endpoints | — | — |
| `/llms.txt` | Top-level agent discovery index (llms.txt convention) | — | — |
| `/sitemap-agent.json` | Canonical machine-readable sitemap of every agent-relevant URL on FlowLink | — | `/.well-known/agent-sitemap.md` |

## signal

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/.well-known/agent-sitemap.md` | Human-readable companion to `sitemap-agent.json` (markdown table grouped by kind) | `/sitemap-agent.json` | — |
| `/.well-known/flowlink-receipt-pubkey.pem` | ed25519 public key used to verify FlowLink settlement receipts | — | — |
| `/.well-known/jwks.json` | JWKS for verifying SIWE-derived session bearer tokens | — | — |
| `/robots.txt` | Crawler policy: explicitly allows GPTBot, ClaudeBot, Claude-Web, anthropic-ai, Google-Extended, PerplexityBot | — | — |

## page-spec

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/dashboard/agents` | Page-spec sibling: structured description of `/dashboard/agents` for agents | `/skills/dashboard.md` | `/dashboard/agents` |
| `/dashboard/keys` | Page-spec sibling: structured description of `/dashboard/keys` for agents | `/skills/dashboard.md` | `/dashboard/keys` |

## human-page

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/` | Marketing landing page describing FlowLink and the agent-payments thesis | `/llms.txt` | — |
| `/dashboard` | Human dashboard root (overview + nav into keys, agents, settings) | `/skills/dashboard.md` | — |
| `/dashboard/agents` | Human UI for live observability of agent traffic per key fingerprint | `/skills/dashboard.md` | — |
| `/dashboard/keys` | Human UI for minting and revoking API keys | `/skills/dashboard.md` | — |

## api

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/api/admin/keys` | Admin: mint, list, and revoke API keys (admin token required) | `/skills/admin.md` | `/dashboard/keys` |
| `/api/admin/observability` | Admin: aggregate per-key request volume, latency, and error stats | `/skills/admin.md` | `/dashboard/agents` |
| `/api/webhooks/hsp` | Inbound HSP settlement callback (signed by HashKey, verified server-side) | — | — |
| `/mcp` | MCP SSE endpoint exposing FlowLink skills as remote tools (bearer auth) | `/.well-known/mcp.json` | — |
| `/v1/auth/siwe/nonce` | Mint a single-use EIP-4361 nonce for Sign-In-With-Ethereum | — | — |
| `/v1/auth/siwe/verify` | Verify a signed SIWE message and exchange it for a session bearer token | — | — |
| `/v1/auth/whoami` | Return the caller identity (address or key fingerprint) and active scopes | — | — |
| `/v1/compliance/check` | Pre-flight OFAC + velocity screening for a counterparty (fail-closed) | `/skills/compliance.md` | — |
| `/v1/invoices` | Create a new invoice or list invoices for the authenticated principal | `/skills/invoice.md` | — |
| `/v1/invoices/[id]` | Read or cancel a specific invoice by id | `/skills/invoice.md` | — |
| `/v1/pay` | Settle an invoice via HSP Single-Pay mandate on HashKey Chain (id 133) | `/skills/pay.md` | — |
| `/v1/receipts` | List ed25519-signed settlement receipts for the authenticated principal | `/skills/receipt.md` | — |
| `/v1/receipts/[id]` | Fetch a single ed25519-signed settlement receipt by id | `/skills/receipt.md` | — |
| `/v1/reputation/[address]` | Counterparty trust score and on-chain history for an address | `/skills/reputation.md` | — |
| `/v1/transactions/[id]` | Read a settlement transaction lifecycle record by id | — | — |
| `/v1/transactions/[id]/events` | Stream lifecycle events for a settlement transaction (compliance, broadcast, receipt) | — | — |
