# Current Work

> **Update rule (added 2026-07-22, after this file grew to 851 lines / 26
> session write-ups):** this file holds **only what's currently open** —
> unresolved bugs, an in-progress task, or a decision still pending. It is
> NOT a changelog or session diary.
> - When a task finishes clean (tests pass, shipped, nothing left to track),
>   **do not add an entry** — the commit message + diff already say what
>   changed; `git log`/`git show <hash>` is authoritative for history.
> - When a bug/task you added an entry for gets fixed, **delete that entry**
>   instead of appending a "✅ fixed" follow-up under it.
> - If something is architecturally significant (new data source, changed
>   priority chain, changed storage approach, new constraint), it goes in
>   `.ai/DECISIONS.md` as an ADR, not as a paragraph here — DECISIONS.md is
>   the durable record; this file is scratch space for what's still in
>   flight.
> - Target size: well under ~100 lines. If an entry needs more than a
>   symptom + suspected cause + pointer to fuller detail (BACKLOG.md/a
>   source file's own docstring), it's probably trying to be a changelog —
>   trim it.

## 🚨 Open: Track stops updating after aircraft selection (CRITICAL)

**Symptom:** Track renders and updates normally while polling. Clicking a
marker to select it → sidebar opens correctly → track stops updating and
goes stale (no longer follows the aircraft on subsequent polls).

**Suspected cause:** `loadTrack()`'s historical-track fetch may be
overwriting or disconnecting the live-trail update path in the poll loop.
Full symptom detail, affected code, and verification steps: `.ai/BACKLOG.md`
§ Bugs. Not yet investigated.

## 🐛 Open: commit-hook `if` matcher fires unreliably

`capture-test-run.sh`/`require-verification.sh`/`backlog-cleanup.sh` (and
the other hooks sharing the same `if: Bash(git commit *)` condition in
`.claude/settings.json`) don't reliably fire only on real `git commit`
invocations. Confirmed 2026-07-22: a bare `count_file="$(mktemp)"` with no
"git" or "commit" text anywhere triggered `check-current-md.sh`'s deny,
while a plain `awk 'BEGIN{...}'` call did not — so the trigger is broader
and stranger than "matches the word commit," and not yet root-caused. This
makes live, in-session testing of these hooks unreliable; verify hook
changes via direct piped invocation of the script instead (bypass the
`if` chain entirely), as done for the 2026-07-22 `backlog-cleanup.sh` fix.

Practical effect: `capture-test-run.sh` can't be trusted to have populated
fresh `.claude/test-runs/*.json` markers just because tests were run this
session — check the marker's own timestamp/exit code before relying on
`require-verification.sh` passing.

## 📋 Audit completed: Test suite redundancy & CI failures (2026-07-22)

**Action taken:** Created `.ai/audits/test-suite-audit-2026-07-22.md` documenting:
- CI red for 6 consecutive commits (active bug)
- 2 failing tests: `test_dev_aircraft_table.spec.js:89` (hardcoded row count),
  `test_identity_enrichment.spec.js:263` (category priority mismatch)
- Redundancy: C0–C5 combinatorial clones, cross-layer duplication
- Added backlog item linking the audit (status 🐛, effort M, value Med–High)

**No code changes this session** — audit-only. Recommendations for remediation
(parametrize C0–C5 tests, fix the 2 failures, trim frontend duplication) are
documented in the audit file and linked from `.ai/BACKLOG.md`. A future
session can pick this up as a concrete task if the user decides to act on it.

---

**Next session:** Pick a backlog item from `.ai/BACKLOG.md`'s "At a glance"
table (sorted best-first) and update this file if a task turns out to
still be open at the end of the session — otherwise a plain commit is enough.
