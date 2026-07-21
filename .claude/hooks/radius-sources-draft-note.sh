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

# Cheap bail: nothing to do unless app.py itself is staged
staged="$(git diff --cached --name-only || true)"
if ! echo "$staged" | grep -qx 'app.py'; then
  allow
fi

current_file=".ai/CURRENT.md"
[ ! -f "$current_file" ] && allow

# Extract only the diff hunks (within app.py's diff) that mention RADIUS_SOURCES
hunk="$(git diff --cached -U3 -- app.py | awk '
  /^@@/ { if (keep && buf != "") printf "%s", buf; buf=$0 "\n"; keep=0; next }
  { buf = buf $0 "\n" }
  /RADIUS_SOURCES/ { keep=1 }
  END { if (keep && buf != "") printf "%s", buf }
')"

if [ -z "$hunk" ]; then
  allow
fi

today="$(date +%Y-%m-%d)"
note_file="$(mktemp)"
{
  echo "## Draft note (auto-generated) — ${today}, via radius-sources-draft-note.sh"
  echo
  echo '`RADIUS_SOURCES` changed in this commit:'
  echo
  echo '```diff'
  printf '%s\n' "$hunk"
  echo '```'
  echo
  echo "_Auto-generated — replace with a real summary (or delete if this note is"
  echo "redundant with a change already described elsewhere) before the next"
  echo "commit touching this file._"
  echo
} > "$note_file"

# Prepend right after the "# Current Work" H1 line (line 1), keep the rest of the file after it
{
  head -n 1 "$current_file"
  echo
  cat "$note_file"
  tail -n +2 "$current_file"
} > "$current_file.tmp"
mv "$current_file.tmp" "$current_file"
rm -f "$note_file"

git add "$current_file"

msg="📝 RADIUS_SOURCES changed — draft note added to .ai/CURRENT.md (edit before your next commit)"
echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"allow\"},\"systemMessage\":\"$msg\"}"
