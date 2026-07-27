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
event="$(echo "$input" | jq -r '.hook_event_name // empty')"
reported_exit_code="$(echo "$input" | jq -r '.tool_response.exitCode // .tool_response.exit_code // empty')"

[ -z "$cmd" ] && exit 0

# Current Claude Code separates successful and failed calls into
# PostToolUse and PostToolUseFailure events. A successful Bash response does
# not carry an exitCode field, so the event itself is the authoritative zero.
# On failure, preserve a reported numeric status when the error includes one;
# otherwise 1 is sufficient to invalidate any older green marker.
case "$event" in
  PostToolUse)
    exit_code="${reported_exit_code:-0}"
    ;;
  PostToolUseFailure)
    exit_code="$reported_exit_code"
    if [ -z "$exit_code" ]; then
      error="$(echo "$input" | jq -r '.error // empty')"
      exit_code="$(printf '%s\n' "$error" | sed -nE 's/.*status code ([0-9]+).*/\1/p' | head -n 1)"
    fi
    [ -z "$exit_code" ] && exit_code=1
    ;;
  *)
    # Compatibility with older hook payloads that included the process status
    # directly in tool_response.
    exit_code="$reported_exit_code"
    [ -z "$exit_code" ] && exit 0
    ;;
esac

case "$exit_code" in
  ''|*[!0-9]*) exit_code=1 ;;
esac

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$repo_root" ] && exit 0

runs_dir="$repo_root/.claude/test-runs"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_marker() {
  local category="$1"
  mkdir -p "$runs_dir"
  jq -n --arg ts "$ts" --arg cmd "$cmd" --argjson exit_code "$exit_code" \
    '{ts: $ts, exit_code: $exit_code, command: $cmd}' \
    > "$runs_dir/$category.json"
}

# Backend: any pytest invocation (a full `pytest` run covers tests/backend
# too, since that's this repo's only backend test dir).
if echo "$cmd" | grep -qE '(^|[[:space:]/])pytest([[:space:]]|$)'; then
  write_marker "backend"
fi

# Frontend: playwright test runs.
if echo "$cmd" | grep -qE 'playwright (test|run)|npx playwright'; then
  write_marker "frontend"
fi

# Live check: an actual curl (or wget) against the running dev server,
# proof a route was hit for real rather than assumed from source reading.
if echo "$cmd" | grep -qE '(^|[[:space:]/])curl[[:space:]].*(127\.0\.0\.1|localhost):(5051|5050)'; then
  write_marker "live_check"
fi

exit 0
