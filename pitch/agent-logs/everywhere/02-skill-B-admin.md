# Skill Author B — admin.md

Wrote `/home/akash/PROJECTS/flowlink/public/skills/admin.md` (4059 bytes, under the 4 KB cap).
Documents the four `/api/admin/*` operations: `list_keys` (GET), `mint_key` (POST, raw key
returned ONCE in `rawKey`), `revoke_key` (DELETE, idempotent + ownership-enforced), and
`observability` (GET ?window=N, p50/p95 + top fingerprints + status breakdown). Each entry
has request, sanitized response, and a consolidated copy-paste curl block at the bottom.
Frontmatter matches the canonical shape (skill, version, stability=beta, auth=[admin-token],
scopes=[], idempotent=false, related_skills=[dashboard, errors]). Errors delegated to
errors.md per spec; dashboard.md cross-referenced. Security note explicitly flags the
X-Admin-Token shared-secret as dev-only with v0.3 swap to scoped JWTs.
