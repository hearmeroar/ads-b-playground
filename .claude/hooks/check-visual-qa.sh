#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"
cmd="$(echo "$input" | jq -r '.tool_input.command // empty')"

allow() { echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'; exit 0; }
deny() {
  jq -n --arg reason "$1" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
  exit 0
}

# Portable sha256 (macOS has no sha256sum by default; Linux has no shasum by default)
sha256() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

# Only run for git commit
if ! echo "$cmd" | grep -q 'git commit'; then
  allow
fi

# Escape hatch: explicit opt-out, same convention as --no-current-check.
# Intended for commits with no visible-behavior claim to verify (e.g. a
# comment-only change) or a genuine emergency — not a routine bypass.
# Supports both --no-visual-check (legacy) and --skip-verification (unified).
if echo "$cmd" | grep -q -- '--no-visual-check\|--skip-verification'; then
  allow
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$repo_root" ] && allow

cd "$repo_root"

# Visual QA required only for style.css and major index.html changes.
# static/js/*.js changes are covered by test suites; minimal Visual QA gate overhead for JS-only changes.
staged_visual_files="$(git diff --cached --name-only | grep -E '^static/(style\.css|index\.html)$' | sort || true)"

if [ -z "$staged_visual_files" ]; then
  allow
fi

report_file=".claude/visual-qa-report.json"

if [ ! -f "$report_file" ]; then
  deny "This commit touches visually-checkable frontend file(s):
$staged_visual_files

Per .agents/visual-qa.md, a UI change must be verified in a real browser
(DOM + computed-style + screenshot checks) before committing. No
$report_file was found. Stage your changes, invoke the visual-tester
subagent (Agent tool, subagent_type: visual-tester) with the task's
visible-behavior claims, let it write $report_file, then retry the
commit. If this commit genuinely has no visible-behavior claim to verify
(e.g. a comment-only change), append --no-visual-check to the git commit
command instead."
fi

if ! jq -e '(.claims // []) as $c | ($c | length) > 0 and (.diff_hash // false)' "$report_file" > /dev/null 2>&1; then
  deny "$report_file exists but is malformed (needs a non-empty .claims
array and a .diff_hash). Re-run the visual-tester subagent to regenerate
it, then retry the commit."
fi

current_hash="$(git diff --cached -- $staged_visual_files | sha256)"
report_hash="$(jq -r '.diff_hash' "$report_file")"

if [ "$current_hash" != "$report_hash" ]; then
  deny "$report_file is stale: the staged diff for
$staged_visual_files
has changed since that report was generated (hash mismatch). Something
was edited after visual-tester ran. Re-run the visual-tester subagent
against the current staged diff, let it rewrite $report_file, then retry
the commit."
fi

failed="$(jq -r '[.claims[] | select(.verdict != "confirmed")] | length' "$report_file")"

if [ "$failed" != "0" ]; then
  failing_claims="$(jq -r '.claims[] | select(.verdict != "confirmed") | "- [\(.verdict)] \(.claim)"' "$report_file")"
  deny "visual-tester did not confirm every claim for this change:

$failing_claims

A commit touching visually-checkable files must not proceed until every
claim's verdict is \"confirmed\" (not \"partial\" or \"not confirmed\").
Fix the underlying UI change (or correct the claim if it was wrong), stage
the fix, re-run visual-tester, then retry the commit."
fi

allow
