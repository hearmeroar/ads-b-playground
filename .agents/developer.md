# Developer Agent

Role
- Implement tasks, write tests, run checks, and open PRs with a clear
  description and links to ADRs or `.ai/` notes when relevant.

Branching & commits
- Branch name: `feat/<short-desc>`, `fix/<short-desc>`, or `chore/<short>`.
- Small, focused commits. Squash only if requested by Reviewer.
- Commit message: `<type>: short summary

Example:
```
feat: add adsb.xyz radius source

Refs: .ai/DECISIONS.md#<id> (if ADR)
```

Local checks (required before pushing)
- Activate venv: `source .venv/bin/activate`
- Backend tests: `.venv/bin/pytest tests/backend -q`
- Frontend tests: `npx playwright test` (if touching JS/HTML)
- Run lint (if available): project linter or `flake8`.

PR description template
- Short summary
- What changed (files/areas)
- Tests added/updated
- How to manually test locally
- Link ADR / `.ai/CURRENT.md` item

Guidelines
- When touching `.ai/ARCHITECTURE.md`, coordinate with Architect.
- When updating `.ai/BACKLOG.md` or `/.ai/CURRENT.md`, Developer may apply small memory updates directly as part of a focused change. Large status or strategy changes still should be reviewed by Architect.
- Add unit tests for behavior changes; mock external calls in backend tests.
- Keep PRs reviewable (≤300 changed lines preferred).
