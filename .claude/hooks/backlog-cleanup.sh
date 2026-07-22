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

# A line counts as "completed" under either convention:
#   1. Standalone prose line starting with ✅ (the original convention:
#      `✅ **Feature Name** — description`).
#   2. A markdown table row (`| ... | ... |`) where at least one
#      pipe-delimited, trimmed cell is exactly ✅ (the Status-column
#      convention added 2026-07-22).
# A single awk pass counts removed lines (via an END block writing to
# count_file) and writes survivors to out_file, so the file is only
# parsed once.
count_file="$(mktemp)"
out_file="$backlog_file.tmp"

awk -v count_file="$count_file" '
  BEGIN { removed = 0 }
  /^[ \t]*✅[ \t]/ { removed++; next }
  /^\|.*\|[ \t]*$/ {
    is_done = 0
    n = split($0, cells, "|")
    for (i = 1; i <= n; i++) {
      f = cells[i]
      gsub(/^[ \t]+|[ \t]+$/, "", f)
      if (f == "✅") { is_done = 1; break }
    }
    # Legacy convention, still found in rows predating the Status-column
    # convention: the checkmark is prefixed onto the Item cell itself
    # (a row like: pipe, checkmark, Feature, pipe, dots, pipe), not its
    # own column. The leading empty field split() produces (everything
    # before the opening pipe) means the Item cell is always cells[2] --
    # checked by itself, not looped with every cell above, so a checkmark
    # appearing later in some other column (e.g. a Read/description cell
    # that just mentions a sub-item shipped) is never mistaken for the
    # whole row being done.
    if (!is_done && n >= 2) {
      item = cells[2]
      gsub(/^[ \t]+|[ \t]+$/, "", item)
      if (item ~ /^✅[ \t]/) { is_done = 1 }
    }
    if (is_done) { removed++; next }
  }
  { print }
  END { print removed > count_file }
' "$backlog_file" > "$out_file"

before=$(cat "$count_file")
rm -f "$count_file"

if [ "$before" -eq 0 ]; then
  rm -f "$out_file"
  allow
fi

mv "$out_file" "$backlog_file"
git add "$backlog_file"
msg="Auto-pruned $before completed item(s) from .ai/BACKLOG.md"
echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"allow\"},\"systemMessage\":\"$msg\"}"
