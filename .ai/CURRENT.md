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
