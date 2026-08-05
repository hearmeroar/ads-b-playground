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

# Idempotency guard: without this, the hook re-inserts (and re-stages,
# bumping .ai/CURRENT.md's mtime) this note on *every* commit attempt that
# touches this RADIUS_SOURCES hunk — including attempts blocked by an
# unrelated hook — which fights require-verification.sh's freshness check
# (a staged file's mtime must not postdate the last green test-run marker)
# in an unbreakable loop: this hook bumps the mtime, the other hook then
# sees a "newer" staged file and blocks, the agent reruns tests and retries,
# this hook bumps the mtime again, forever. Keyed on a hash of the hunk
# content (not on whether the note text is still present in CURRENT.md —
# a human/agent replacing the auto-note with a real summary, per its own
# instructions, must not make it reappear) so a given RADIUS_SOURCES change
# is only ever flagged once per session, even across many commit attempts.
sentinel_dir=".claude/.radius-sources-note-seen"
mkdir -p "$sentinel_dir"
hunk_hash="$(printf '%s' "$hunk" | (command -v sha256sum >/dev/null 2>&1 && sha256sum || shasum -a 256) | awk '{print $1}')"
sentinel_file="$sentinel_dir/$hunk_hash"
if [ -f "$sentinel_file" ]; then
  allow
fi
touch "$sentinel_file"

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
