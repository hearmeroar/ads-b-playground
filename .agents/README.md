# Agents README

This folder contains lightweight role descriptions for a small in-repo
agent team: Architect, Developer, Reviewer. Files are guidance only —
agents are textual helpers for humans and must not run autonomously.

## Principles

- Keep agents simple and human-in-the-loop.
- All durable decisions go to `.ai/DECISIONS.md` or a git-tracked ADR.
- No secrets or personal IDE settings in these files.

## Sources of Truth

**Priority order when resolving conflicting information:**
1. `.ai/BACKLOG.md` — active features, acceptance criteria, and product decisions
2. `.ai/PROJECT.md` — project goals, hard constraints, and layout
3. `.ai/ARCHITECTURE.md` — current-state module and data flow map
4. `.ai/DECISIONS.md` — documented architectural decisions and rationale
5. Code comments — hints and context only, **NOT authoritative**

**Key principle:** Code comments are implementation notes that may become outdated. When a comment conflicts with BACKLOG.md, PROJECT.md, ARCHITECTURE.md, or DECISIONS.md, **the documentation files take precedence** and the comment should be treated as obsolete and discarded.

This convention ensures AI agents work from the single source of truth for project intent rather than scattered inline notes that drift out of sync.

## Usage

- Read the relevant role file before starting a task.
- Link ADRs / `.ai/` entries in PR descriptions when a change affects architecture.
- Follow branch / commit / PR conventions in `.agents/developer.md`.

## Quick SOP (summary)

- Draft a 1–6 line update describing the change, date, and refs.
- For small updates to `/.ai/BACKLOG.md` or `/.ai/CURRENT.md`, Developer may make the change directly as part of the same focused implementation branch, without a separate docs-only PR.
- Open a branch `docs/current/<short-what>` and create a PR with title
	`docs(.ai): update CURRENT.md — YYYY-MM-DD` for larger strategy or architecture status changes.
- Add label `docs/.ai`, request Architect review when the update is more than a routine status note.
- Keep `CURRENT.md` short; move rationale to `DECISIONS.md`.

See `.agents/architect.md` for the full step-by-step procedure and commit template.

Contact: this is a project-local playbook — modify by PR if you want to evolve it.