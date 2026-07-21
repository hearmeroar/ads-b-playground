#!/usr/bin/env bash
set -euo pipefail

# PreToolUse hook (matcher: Bash, if: git commit). Blocks a commit unless
# there's *mechanical* evidence — a marker written by capture-test-run.sh
# from a command's real exit code — that the touched area was actually
# tested/verified this session, not just claimed to work.
#
# This exists because an agent (or human) reading code and reasoning "this
# should work" is not the same as running it. A route can pass every unit
# test and still 404 in practice (wrong path string, wrong blueprint
# prefix, etc.) — the only way to know is to actually hit it.

input="$(cat)"
cmd="$(echo "$input" | jq -r '.tool_input.command // empty')"

allow() { echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'; exit 0; }
deny() {
  jq -n --arg reason "$1" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
  exit 0
}

if echo "$cmd" | grep -q -- '--no-verify-check'; then
  allow
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$repo_root" ] && allow

cd "$repo_root"
runs_dir=".claude/test-runs"

staged="$(git diff --cached --name-only || true)"
[ -z "$staged" ] && allow

# Newest mtime among staged files' *working tree* content — a marker is
# only "fresh" if it postdates the last edit to what's being committed.
# (git diff --cached --name-only lists paths; stat the working copy since
# that's what was actually edited/tested against.)
newest_edit=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  m="$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)"
  [ "$m" -gt "$newest_edit" ] && newest_edit="$m"
done <<< "$staged"

marker_is_fresh_and_green() {
  local marker="$runs_dir/$1.json"
  [ -f "$marker" ] || return 1
  local exit_code marker_ts marker_epoch
  exit_code="$(jq -r '.exit_code' "$marker" 2>/dev/null || echo 1)"
  marker_ts="$(jq -r '.ts' "$marker" 2>/dev/null || echo "")"
  [ "$exit_code" = "0" ] || return 1
  [ -z "$marker_ts" ] && return 1
  marker_epoch="$(date -u -d "$marker_ts" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$marker_ts" +%s 2>/dev/null || echo 0)"
  [ "$marker_epoch" -ge "$newest_edit" ]
}

missing=""

if echo "$staged" | grep -qE '^(app\.py|storage\.py|enrichment/|tests/backend/)'; then
  marker_is_fresh_and_green "backend" || missing="$missing- pytest hasn't been run (with a passing exit code) since the last edit to app.py/storage.py/enrichment/tests-backend. Run: .venv/bin/pytest tests/backend\n"
fi

if echo "$staged" | grep -qE '^(static/|tests/frontend/)'; then
  marker_is_fresh_and_green "frontend" || missing="$missing- Playwright hasn't been run (with a passing exit code) since the last edit to static/ or tests/frontend/. Run: npx playwright test\n"
fi

# Route changes specifically need a live curl hit, not just unit tests —
# a Flask test client bypasses the real HTTP path/prefix that broke the
# /api/health rollout this rule exists because of.
route_diff="$(git diff --cached -- app.py 2>/dev/null | grep -E '^\+.*@app\.route' || true)"
if [ -n "$route_diff" ]; then
  marker_is_fresh_and_green "live_check" || missing="$missing- app.py has a new/changed @app.route but no fresh curl against a running server was recorded. Start the app and run: curl http://127.0.0.1:5051/<path>\n"
fi

if [ -n "$missing" ]; then
  reason="Commit blocked: verification evidence missing or stale.\n${missing}If this commit genuinely needs no fresh verification (docs-only, comment tweak), append --no-verify-check to the git commit command."
  deny "$reason"
fi

allow
