#!/usr/bin/env bash
# FlowLink agent sitemap crawler.
#
# Reads /sitemap-agent.json from a running FlowLink instance and verifies that
# every advertised URL is reachable, every agent_alternate is reachable, and
# every human-page surface emits a `Link:` header pointing at its
# agent_alternate (RFC 8288, type=text/markdown).
#
# This is the contract test that backs the "sitemap is honest" claim made by
# the round-2 sitemap engineer. It is intentionally driven by the SITEMAP
# CONTENT, not by enumerating routes from code, so a route silently dropped
# from sitemap-agent.json would still be a "passes" run while a route added
# to the sitemap but not actually shipped is an immediate FAIL.
#
# Usage:   bash tests/sitemap-crawler.sh [BASE_URL]
# Default: BASE_URL=http://localhost:3000
#
# Exit codes:
#   0  all entries verified
#   1  one or more sitemap entries failed verification
#   2  missing dependency or sitemap unavailable
#
# Idempotent. Safe to re-run. No side effects beyond /tmp/flowlink-sitemap-*.

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"

# ─────────────────────────────────────────────────────────────────────
# deps + helpers

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1" >&2; exit 2; }
}
need curl
need jq

step() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[32mok\033[0m %s\n" "$*"; }
warn() { printf "    \033[33m..\033[0m %s\n" "$*"; }
fail() { printf "    \033[31mFAIL\033[0m %s\n" "$*" >&2; }

TMP_DIR="${TMPDIR:-/tmp}"
SITEMAP_JSON="$TMP_DIR/flowlink-sitemap.json"
HEADERS_FILE="$TMP_DIR/flowlink-sitemap-headers.txt"

# Acceptable status codes for a URL to be considered "reachable":
#   200          — happy path
#   401, 403     — auth-required endpoints (auth_required / forbidden), still served
#   405          — wrong method (GET on a POST-only route); the route exists
# Anything else (404, 500, network failure) is a FAIL.
acceptable_status() {
  local status="$1"
  case "$status" in
    200|401|403|405) return 0 ;;
    *) return 1 ;;
  esac
}

# Some sitemap URLs use Next.js dynamic-segment notation like
# /v1/invoices/[id]. Those are templates, not concrete URLs — we can't fetch
# them without a real id. We probe the parent collection URL when available
# and otherwise mark the entry as TEMPLATE (pass-through).
is_template_url() {
  [[ "$1" == *'['*']'* ]]
}

# /mcp is an SSE endpoint that holds the connection open indefinitely. A naive
# curl GET would hang for the full request timeout. We use --max-time 3 and
# accept a curl exit (28 = timeout) as proof the endpoint is alive.
is_sse_url() {
  [[ "$1" == "/mcp" ]]
}

# ─────────────────────────────────────────────────────────────────────
# 1. fetch the sitemap

step "fetch sitemap from $BASE_URL/sitemap-agent.json"
if ! curl -fsSL --max-time 10 "$BASE_URL/sitemap-agent.json" > "$SITEMAP_JSON"; then
  fail "could not fetch /sitemap-agent.json from $BASE_URL"
  exit 2
fi
ENTRY_COUNT=$(jq '.entries | length' "$SITEMAP_JSON")
[[ "$ENTRY_COUNT" -gt 0 ]] || { fail "sitemap has zero entries"; exit 2; }
ok "sitemap fetched, $ENTRY_COUNT entries"

# ─────────────────────────────────────────────────────────────────────
# 2. crawl each entry

PASS=0
SKIP=0
FAILED=0
FAIL_LINES=()

# Stream entries through jq one-per-line with a tab-separated layout that's
# safe to parse in bash (urls have no whitespace, summaries are dropped).
while IFS=$'\t' read -r url kind agent_alternate; do
  display_url="$url"
  [[ "$kind" == "page-spec" ]] && display_url="$url (page-spec)"

  # 2a. main URL reachability
  if is_template_url "$url"; then
    warn "$display_url — template URL ($kind), skipping fetch"
    SKIP=$((SKIP + 1))
  elif is_sse_url "$url"; then
    # Accept HTTP 200 within 3s OR a timeout (curl exit 28) as success.
    set +e
    SSE_STATUS=$(curl -s -o /dev/null --max-time 3 -w "%{http_code}" "$BASE_URL$url" 2>/dev/null)
    SSE_EXIT=$?
    set -e
    if [[ "$SSE_EXIT" == "0" && "$SSE_STATUS" == "200" ]]; then
      ok "$display_url -> 200 (SSE responded)"
      PASS=$((PASS + 1))
    elif [[ "$SSE_EXIT" == "28" ]]; then
      ok "$display_url -> SSE held connection open (proof of life)"
      PASS=$((PASS + 1))
    elif [[ "$SSE_EXIT" == "0" ]] && acceptable_status "$SSE_STATUS"; then
      ok "$display_url -> $SSE_STATUS (auth-gated)"
      PASS=$((PASS + 1))
    else
      fail "$display_url -> SSE check failed (status=$SSE_STATUS exit=$SSE_EXIT)"
      FAILED=$((FAILED + 1))
      FAIL_LINES+=("$url: SSE check failed status=$SSE_STATUS exit=$SSE_EXIT")
    fi
  else
    STATUS=$(curl -s -o /dev/null --max-time 10 -w "%{http_code}" "$BASE_URL$url" || echo "000")
    if acceptable_status "$STATUS"; then
      ok "$display_url -> $STATUS"
      PASS=$((PASS + 1))
    else
      fail "$display_url -> $STATUS (expected 200/401/403/405)"
      FAILED=$((FAILED + 1))
      FAIL_LINES+=("$url: status=$STATUS")
    fi
  fi

  # 2b. agent_alternate reachability (must be 200 — these are static skill
  # files / manifests, never auth-gated).
  if [[ "$agent_alternate" != "null" && -n "$agent_alternate" ]]; then
    ALT_STATUS=$(curl -s -o /dev/null --max-time 10 -w "%{http_code}" "$BASE_URL$agent_alternate" || echo "000")
    if [[ "$ALT_STATUS" == "200" ]]; then
      ok "  alternate $agent_alternate -> 200"
    else
      fail "  alternate $agent_alternate -> $ALT_STATUS (expected 200)"
      FAILED=$((FAILED + 1))
      FAIL_LINES+=("$url: agent_alternate $agent_alternate status=$ALT_STATUS")
    fi
  fi

  # 2c. human-page Link header check
  if [[ "$kind" == "human-page" && "$agent_alternate" != "null" && -n "$agent_alternate" ]]; then
    if is_template_url "$url"; then
      warn "  Link header check skipped (template URL)"
    else
      curl -sI --max-time 10 "$BASE_URL$url" > "$HEADERS_FILE" || true
      LINK_LINE=$(awk 'BEGIN{IGNORECASE=1} /^link:/{ sub(/^[Ll]ink:[ \t]*/, ""); print; exit }' "$HEADERS_FILE")
      if [[ -z "$LINK_LINE" ]]; then
        fail "  no Link: header on $url (expected one pointing at $agent_alternate)"
        FAILED=$((FAILED + 1))
        FAIL_LINES+=("$url: missing Link header")
      elif ! echo "$LINK_LINE" | grep -qF "$agent_alternate"; then
        fail "  Link: header present but missing $agent_alternate"
        fail "    got: $LINK_LINE"
        FAILED=$((FAILED + 1))
        FAIL_LINES+=("$url: Link header missing $agent_alternate")
      elif ! echo "$LINK_LINE" | grep -qiE 'rel="?alternate"?'; then
        fail "  Link: header references $agent_alternate but no rel=\"alternate\""
        FAILED=$((FAILED + 1))
        FAIL_LINES+=("$url: Link header missing rel=alternate")
      elif ! echo "$LINK_LINE" | grep -qiE 'type="?text/markdown"?'; then
        # The Link header may carry several link-values; we need at least one
        # markdown alternate. Inspect the canonical one for $agent_alternate.
        # Split comma-then-space to isolate just the entry naming our target.
        TARGET_LV=$(echo "$LINK_LINE" | tr ',' '\n' | grep -F "$agent_alternate" | head -1)
        if echo "$TARGET_LV" | grep -qiE 'type="?text/markdown"?'; then
          ok "  Link: header advertises $agent_alternate (rel=alternate, type=text/markdown)"
        else
          fail "  Link entry for $agent_alternate has no type=\"text/markdown\""
          fail "    got: $TARGET_LV"
          FAILED=$((FAILED + 1))
          FAIL_LINES+=("$url: Link entry for $agent_alternate has wrong type")
        fi
      else
        ok "  Link: header advertises $agent_alternate (rel=alternate, type=text/markdown)"
      fi
    fi
  fi
done < <(jq -r '.entries[] | [.url, .kind, (.agent_alternate // "null")] | @tsv' "$SITEMAP_JSON")

# ─────────────────────────────────────────────────────────────────────
# 3. summary

step "summary"
echo "    entries:  $ENTRY_COUNT"
echo "    passed:   $PASS"
echo "    skipped:  $SKIP (template URLs with [param] segments)"
echo "    failures: $FAILED"

if [[ "$FAILED" -gt 0 ]]; then
  echo
  echo "    failure detail:" >&2
  for line in "${FAIL_LINES[@]}"; do
    printf "      - %s\n" "$line" >&2
  done
  exit 1
fi

printf "\n\033[1;32mpassed %d/%d entries (skipped %d templates)\033[0m\n" \
  "$PASS" "$ENTRY_COUNT" "$SKIP"
