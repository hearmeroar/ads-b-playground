# Architect Agent

Role
- Responsible for high-level architectural decisions, system integrity,
  and documenting decisions in the project memory.

Responsibilities
- Evaluate impact of major changes (new sources, storage, infra changes).
- Update `.ai/ARCHITECTURE.md`, `.ai/DECISIONS.md` and `.ai/CURRENT.md`.
- Create ADRs for structural decisions; keep ADRs short and dated.
- Provide an implementation checklist to Developer before work begins.

When to act
- Any change that touches data model, cross-process storage, external
  quota models, or the priority/order of data sources.

Outputs
- ADR (in `.ai/DECISIONS.md` or `docs/adr/`), impact analysis, checklist.

Guardrails
- Do not modify code directly; create an ADR + small plan and assign Developer.
- Keep changes incremental; prefer configuration and feature flags when possible.

CURRENT.md ownership
- Primary owner: **Architect** — responsible for major architectural status and strategic direction.
- Secondary: **Developer** may apply small, non-controversial updates directly to `/.ai/CURRENT.md` when they reflect an already-completed implementation or a narrow operational status change. Larger roadmap or architecture-status revisions should still involve the Architect.
- Automation: agents/assistants may prepare draft text and apply it directly as part of a code or memory update, but should label the change clearly and keep it small.
- **Mechanical enforcement** (since 2026-07-21): `git commit` is blocked unless `.ai/CURRENT.md` is staged. Use `--no-current-check` to bypass for commits that don't change task status (e.g., trivial fixes, docs-only). See `.claude/hooks/check-current-md.sh`.

BACKLOG.md ownership
- Items are pruned automatically: mark completed items with `✅ ` prefix (e.g., `✅ **Feature Name**`). The `.claude/hooks/backlog-cleanup.sh` hook removes these lines before each commit, with optional auto-stage if items were found. Keep the `✅` marking convention to maintain clean, automated backlog hygiene.
- **Multi-paragraph items — delete in full when done, don't just mark the title line.** The hook only strips the single line starting with `✅`; for a long-form Goal/Motivation/Acceptance-criteria item, marking just the title leaves its body orphaned with no heading (this happened at least twice before it was noticed and fixed 2026-07-21). Whoever marks a multi-paragraph item complete should delete the whole block by hand in the same edit, not rely on the hook.
- **Effort/value estimate required (since 2026-07-21):** every item added or materially edited must get a row in the "At a glance" table at the top of `.ai/BACKLOG.md` — Effort (`XS`/`S`/`M`/`L`/`XL`) and Value (`Low`/`Medium`/`High`), judged against the app's actual current use, not hypothetical scale. This is what the table is for; don't let it drift out of sync with the item sections below it. (Column renamed from "Speed" to "Effort" 2026-07-21 — "Speed" read as execution velocity, not size/complexity, which is what it actually measures.)
- Otherwise follows same ownership as CURRENT.md: Architect owns major roadmap changes, Developer may add small parked ideas.

Soft nudges for ARCHITECTURE.md and DECISIONS.md
- When `app.py`, `storage.py`, or `enrichment/` files are staged, `.claude/hooks/nudge-docs.sh` suggests (but does not block) reviewing/updating ARCHITECTURE.md and DECISIONS.md if those files were not also staged. These are soft reminders only, not hard blocks — use them as cues to think about whether the architectural change warrants documentation updates.

Mechanical verification gate — proof-of-work, not self-report (since 2026-07-21)
- **Why this exists**: the `/api/health` route shipped with `@app.route("/health")` while every caller used `/api/health` — the backend pytest suite passed (it uses Flask's test client, which doesn't care about the literal registered path the way a real HTTP request does), and the mistake was only caught because the user manually curled the real running server and got a 404. An agent (or human) reasoning "the tests pass, this should work" is not the same as actually running it — the two can silently diverge exactly at the seam between a unit test and a real request path.
- **`.claude/hooks/capture-test-run.sh`** (`PostToolUse`, matcher `Bash`, no `if` — fires on every Bash call): inspects the command that just ran and, if it matches a `pytest`, `playwright test`, or `curl` against `127.0.0.1:5051`/`127.0.0.1:5050`, records the command's *real* `tool_response.exitCode` (never the agent's own claim about what happened) into `.claude/test-runs/{backend,frontend,live_check}.json` as `{ts, exit_code, command}`. Gitignored (`.claude/test-runs/`) — this is per-session scratch evidence, not a durable record.
- **`.claude/hooks/require-verification.sh`** (`PreToolUse`, matcher `Bash`, `if: Bash(git commit *)`, last in the chain): before allowing a commit, checks the staged diff against these three markers, each gated on freshness (`marker.ts` must be at or after the newest mtime among the staged files it covers — a marker from *before* the last edit doesn't count):
  - `app.py`/`storage.py`/`enrichment/`/`tests/backend/` staged → requires a fresh, exit-0 `backend` marker (i.e. `pytest tests/backend` was actually run and passed since the last edit).
  - `static/`/`tests/frontend/` staged → requires a fresh, exit-0 `frontend` marker (`playwright test`).
  - A new/changed `@app.route(...)` line in `app.py`'s staged diff → requires a fresh, exit-0 `live_check` marker — a real `curl` against a running dev server, specifically because this is the class of bug (route registered at the wrong path) that a Flask-test-client-based unit test cannot catch, only an actual HTTP request can.
  - Missing/stale evidence → the commit is denied with a message naming exactly which command to run. Bypass with `--no-verify-check` (own flag, independent of `check-current-md.sh`'s `--no-current-check`) for commits that genuinely need no fresh verification (docs-only, comment tweaks).
- **Validated directly** (piping crafted JSON into each script, bypassing the outer session's own hook chain to avoid a self-referential testing loop — see `.ai/CURRENT.md`'s 2026-07-21 entry for the full trace): `capture-test-run.sh` correctly records both passing and failing exit codes for pytest and a real curl hit; `require-verification.sh` correctly denies with no marker, denies with a stale/failing marker, and allows with a fresh passing one.
- **Known limitation**: this only proves a command *ran with exit 0* — it can't verify the command actually exercised the changed code path (e.g. `pytest tests/backend/test_unrelated.py` would satisfy the `backend` marker for an `app.py` change it never touched). It raises the floor from "nothing was run" to "something relevant-looking was run and passed"; it is not a substitute for actually reading what ran and confirming it's the right test/curl.

Auto-drafted note for `RADIUS_SOURCES` changes (since 2026-07-21)
- `RADIUS_SOURCES` (in `app.py`) is the single source of truth for the four anonymous radius sources (adsb.fi/adsb.lol/adsb.one/airplanes.live) — changing an entry is architecturally significant per the "Before creating a commit" rule above, but a plain name-based nudge can't tell that apart from any other `app.py` edit.
- `.claude/hooks/radius-sources-draft-note.sh` inspects the staged `app.py` diff for hunks that actually mention `RADIUS_SOURCES`. If found, it prepends a `## Draft note (auto-generated)` section to the top of `.ai/CURRENT.md` containing the real diff hunk, stages the file, and lets the commit proceed with a `systemMessage` pointing this out.
- This is a draft, not a finished entry — replace it with a real summary (or delete it if redundant) before the *next* commit that touches `app.py`. It runs first in the hook chain specifically so its auto-staging of `.ai/CURRENT.md` also satisfies `check-current-md.sh` for a `RADIUS_SOURCES`-only commit.

Commit template for CURRENT.md
```
docs(.ai): update CURRENT.md — YYYY-MM-DD

Short summary of change

Refs: .agents/architect.md
```

SOP: how to update `/.ai/CURRENT.md` (step-by-step)

1. Prepare draft
  - Author (Developer or AI) prepares a 1–6 line draft describing the change.
  - Include date, short summary, and any relevant PR/ADR/issue links.

2. Open a PR
  - Create a branch `docs/current/<short-what>` from `main`.
  - Push the branch and open a PR titled: `docs(.ai): update CURRENT.md — YYYY-MM-DD`.
  - Add the `docs/.ai` label and request review from the `Architect`.

3. Review & merge
  - Architect reviews the PR, edits as needed, and merges when satisfied.
  - Small, non-architectural edits may be fast-tracked but still require Architect approval.

4. Post-merge housekeeping
  - Architect adds one-line entry to `DECISIONS.md` if the change reflects an ADR or an important decision.
  - Close related issues and link the merge commit in the issue/PR.

Notes
- Keep `/.ai/CURRENT.md` concise — it is a status snapshot, not a long-form changelog.
- Use `DECISIONS.md` for rationale and `BACKLOG.md` for ideas.

Quick ADR template
```
Date: YYYY-MM-DD
Problem: Short description (1 line)
Decision: What we choose
Reasoning: Bullets
Tradeoffs: Bullets
Action items: checklist with owners
```

Example short checklist for "Add new ADS-B source"
- Data model: confirm fields + units
- Cache/TTL: propose MIN_INTERVAL
- Dedup priority: where to insert in `RADIUS_SOURCE_PRIORITY`
- Tests required: backend unit + parser fixture + frontend mock
- Deployment/ops: env vars, quotas, feature flag
