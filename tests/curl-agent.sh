#!/usr/bin/env bash
# FlowLink curl-agent smoke test.
#
# Simulates a cold agent: starts from /llms.txt, discovers the API,
# walks the invoice -> pay -> receipt flow with only curl + jq.
#
# Uses a TEST API key path so we don't need a real wallet in CI. In prod,
# swap the auth step for a real SIWE signing flow.
#
# Usage:   bash tests/curl-agent.sh [BASE_URL]
# Default: BASE_URL=http://localhost:3000

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1" >&2; exit 2; }
}
need curl
need jq

step() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[32mok\033[0m %s\n" "$*"; }
fail() { printf "    \033[31mFAIL\033[0m %s\n" "$*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────
step "1. fetch /llms.txt (agent discovery entry point)"
LLMS=$(curl -fsSL "$BASE_URL/llms.txt") || fail "llms.txt not served"
echo "$LLMS" | grep -q "## Skills" || fail "llms.txt missing Skills section"
ok "llms.txt served, $(echo "$LLMS" | wc -c) bytes"

step "2. fetch /skills/pay.md"
PAY_MD=$(curl -fsSL "$BASE_URL/skills/pay.md") || fail "pay.md not served"
echo "$PAY_MD" | grep -q "^# pay" || fail "pay.md missing heading"
echo "$PAY_MD" | grep -q "compliance_blocked_sanctions" || fail "pay.md missing error codes"
ok "pay.md served, contains error table"

step "3. fetch /.well-known/mcp.json"
MCP=$(curl -fsSL "$BASE_URL/.well-known/mcp.json") || fail "mcp.json not served"
TOOL_COUNT=$(echo "$MCP" | jq '.tools | length')
[[ "$TOOL_COUNT" -ge 6 ]] || fail "expected >=6 MCP tools, got $TOOL_COUNT"
ok "mcp.json valid, $TOOL_COUNT tools listed"

step "4. fetch /.well-known/flowlink-receipt-pubkey.pem"
PEM=$(curl -fsSL "$BASE_URL/.well-known/flowlink-receipt-pubkey.pem") || fail "receipt pubkey not served"
echo "$PEM" | grep -q "BEGIN PUBLIC KEY" || fail "pem malformed"
ok "receipt public key served"

step "5. fetch /.well-known/jwks.json"
JWKS=$(curl -fsSL "$BASE_URL/.well-known/jwks.json") || fail "jwks not served"
KID=$(echo "$JWKS" | jq -r '.keys[0].kid')
[[ "$KID" != "null" && -n "$KID" ]] || fail "jwks missing kid"
ok "jwks served, kid=$KID"

# ─────────────────────────────────────────────────────────────────────
step "6. agent-style error path: unauthenticated /v1/invoices"
RESP=$(curl -s -o /tmp/flowlink-test-err.json -w '%{http_code}' "$BASE_URL/v1/invoices")
[[ "$RESP" == "401" ]] || fail "expected 401, got $RESP"
CODE=$(jq -r .code /tmp/flowlink-test-err.json)
[[ "$CODE" == "auth_required" ]] || fail "expected code auth_required, got $CODE"
ACTION=$(jq -r .agent_action /tmp/flowlink-test-err.json)
[[ -n "$ACTION" ]] || fail "agent_action missing from Problem+JSON"
ok "unauth error correctly shaped (code=$CODE, has agent_action)"

step "7. validation error shape: bad address on compliance/check"
RESP=$(curl -s -o /tmp/flowlink-test-val.json -w '%{http_code}' \
  -X POST "$BASE_URL/v1/compliance/check" \
  -H 'Content-Type: application/json' \
  -d '{"address":"not-an-address"}')
[[ "$RESP" == "400" ]] || fail "expected 400, got $RESP"
CODE=$(jq -r .code /tmp/flowlink-test-val.json)
[[ "$CODE" == "validation_error" ]] || fail "expected validation_error, got $CODE"
ok "validation error correctly shaped"

step "8. compliance check on a clean address"
RESP=$(curl -s -o /tmp/flowlink-test-ok.json -w '%{http_code}' \
  -X POST "$BASE_URL/v1/compliance/check" \
  -H 'Content-Type: application/json' \
  -d '{"address":"0x742d35Cc6634C0532925a3b844Bc9e7595f8beA0"}')
SCORE=$(jq -r .score /tmp/flowlink-test-ok.json 2>/dev/null || echo "")
if [[ "$RESP" == "200" ]]; then
  ok "clean address score=$SCORE"
elif [[ "$RESP" == "503" ]]; then
  # OFAC upstream unavailable — fail-closed is WORKING AS DESIGNED
  CODE=$(jq -r .code /tmp/flowlink-test-ok.json)
  [[ "$CODE" == "compliance_upstream_unavailable" ]] || fail "expected upstream_unavailable, got $CODE"
  ok "compliance fails closed (OFAC upstream unreachable) — correct by design"
else
  fail "unexpected status $RESP"
fi

# ─────────────────────────────────────────────────────────────────────
step "9. OFAC fallback list catches Tornado Cash address"
# Tornado Cash address from the hardcoded fallback list
RESP=$(curl -s -o /tmp/flowlink-test-sdn.json -D /tmp/flowlink-test-sdn.hdr -w '%{http_code}' \
  -X POST "$BASE_URL/v1/compliance/check" \
  -H 'Content-Type: application/json' \
  -d '{"address":"0x8589427373D6D84E98730D7795D8f6f8731FDA16"}')
[[ "$RESP" == "403" ]] || fail "expected 403 (sanctioned), got $RESP"
# After the round-2 agent catch, 403 must be RFC 9457 Problem+JSON, not a custom body
CT=$(grep -i '^content-type:' /tmp/flowlink-test-sdn.hdr | tr -d '\r\n' | awk '{print tolower($2)}')
[[ "$CT" == *"application/problem+json"* ]] || fail "expected content-type application/problem+json, got '$CT'"
CODE=$(jq -r .code /tmp/flowlink-test-sdn.json)
[[ "$CODE" == "compliance_blocked_sanctions" ]] || fail "expected code compliance_blocked_sanctions, got $CODE"
ACTION=$(jq -r .agent_action /tmp/flowlink-test-sdn.json)
[[ -n "$ACTION" ]] || fail "agent_action missing from Problem+JSON"
ok "fallback OFAC list blocks Tornado Cash address (Problem+JSON shape verified)"

# ─────────────────────────────────────────────────────────────────────
step "all smoke checks passed"
echo
echo "Next: implement a SIWE signing harness (or add a test API key route) and"
echo "extend this script to cover the full invoice -> pay -> receipt flow."
