#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"
cmd="$(echo "$input" | jq -r '.tool_input.command // empty')"

allow() { echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'; exit 0; }

# Only run for git commit
if ! echo "$cmd" | grep -q 'git commit'; then
  allow
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$repo_root" ] && allow

cd "$repo_root"

# Get staged files
staged="$(git diff --cached --name-only || true)"

# Check which docs might need updating based on what files changed
nudges=""

# If core architecture files changed, suggest ARCHITECTURE/DECISIONS
if echo "$staged" | grep -E '^(app\.py|storage\.py|enrichment/)' > /dev/null; then
  if ! echo "$staged" | grep -q '\.ai/ARCHITECTURE\.md'; then
    nudges="$nudges"$'💡 ARCHITECTURE.md might need updating (app.py/storage.py/enrichment/ changed)\n'
  fi
  if ! echo "$staged" | grep -q '\.ai/DECISIONS\.md'; then
    nudges="$nudges"$'💡 DECISIONS.md might need updating (architectural change detected)\n'
  fi
fi

if [ -n "$nudges" ]; then
  # Remove trailing newline for the message
  nudges="${nudges%$'\n'}"
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"allow\"},\"systemMessage\":\"$nudges\"}"
else
  allow
fi
