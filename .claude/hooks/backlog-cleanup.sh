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
backlog_file=".ai/BACKLOG.md"

# Only run if BACKLOG.md exists
[ ! -f "$backlog_file" ] && allow

# Count lines with ✅ before cleanup
before=$(grep -c '^\s*✅\s' "$backlog_file" || true)

if [ "$before" -eq 0 ]; then
  allow
fi

# Remove completed lines (lines starting with optional whitespace + ✅)
grep -v '^\s*✅\s' "$backlog_file" > "$backlog_file.tmp" || true
mv "$backlog_file.tmp" "$backlog_file"

# If we removed items, stage the updated file
if [ "$before" -gt 0 ]; then
  git add "$backlog_file"
  msg="Auto-pruned $before completed item(s) from .ai/BACKLOG.md"
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"allow\"},\"systemMessage\":\"$msg\"}"
else
  allow
fi
