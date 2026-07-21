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
