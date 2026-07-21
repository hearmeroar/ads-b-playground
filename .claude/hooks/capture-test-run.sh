#!/usr/bin/env bash
set -euo pipefail

# PostToolUse hook (matcher: Bash). Records the *real* exit code of test/
# verification commands to .claude/test-runs/<category>.json, so a later
# git-commit gate (require-verification.sh) can check actual evidence
# instead of trusting an agent's self-report that "it works".
#
# This never blocks the tool call itself — PostToolUse already ran by the
# time this fires. It only records what happened.

input="$(cat)"
cmd="$(echo "$input" | jq -r '.tool_input.command // empty')"
exit_code="$(echo "$input" | jq -r '.tool_response.exitCode // empty')"

[ -z "$cmd" ] && exit 0
[ -z "$exit_code" ] && exit 0

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$repo_root" ] && exit 0

runs_dir="$repo_root/.claude/test-runs"
mkdir -p "$runs_dir"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_marker() {
  local category="$1"
  jq -n --arg ts "$ts" --arg cmd "$cmd" --argjson exit_code "$exit_code" \
    '{ts: $ts, exit_code: $exit_code, command: $cmd}' \
    > "$runs_dir/$category.json"
}

# Backend: any pytest invocation (a full `pytest` run covers tests/backend
# too, since that's this repo's only backend test dir).
if echo "$cmd" | grep -qE '\bpytest\b'; then
  write_marker "backend"
fi

# Frontend: playwright test runs.
if echo "$cmd" | grep -qE 'playwright (test|run)|npx playwright'; then
  write_marker "frontend"
fi

# Live check: an actual curl (or wget) against the running dev server,
# proof a route was hit for real rather than assumed from source reading.
if echo "$cmd" | grep -qE '\bcurl\b.*(127\.0\.0\.1|localhost):(5051|5050)'; then
  write_marker "live_check"
fi

exit 0
