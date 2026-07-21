#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"
cmd="$(echo "$input" | jq -r '.tool_input.command // empty')"

allow() { echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'; exit 0; }

# Escape hatch: explicit opt-out for commits that genuinely don't change task status
if echo "$cmd" | grep -q -- '--no-current-check'; then
  allow
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$repo_root" ] && allow

cd "$repo_root"

staged="$(git diff --cached --name-only || true)"
if echo "$staged" | grep -qx '\.ai/CURRENT\.md'; then
  allow
fi

reason='.ai/CURRENT.md is not part of this commit'"'"'s staged changes. Per CLAUDE.md'"'"'s "Before creating a commit" checklist: update .ai/CURRENT.md if the active task status changed, then `git add .ai/CURRENT.md` and retry. If this commit genuinely does not change task status (e.g. a trivial fix, or CURRENT.md was already updated in an earlier commit this session), append --no-current-check to the git commit command to bypass this check.'

jq -n --arg reason "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
