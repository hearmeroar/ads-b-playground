# Agents README

This folder contains lightweight role descriptions for a small in-repo
agent team: Architect, Developer, Reviewer. Files are guidance only —
agents are textual helpers for humans and must not run autonomously.

Principles
- Keep agents simple and human-in-the-loop.
- All durable decisions go to `.ai/DECISIONS.md` or a git-tracked ADR.
- No secrets or personal IDE settings in these files.

Usage
- Read the relevant role file before starting a task.
- Link ADRs / `.ai/` entries in PR descriptions when a change affects architecture.
- Follow branch / commit / PR conventions in `.agents/developer.md`.

 Quick SOP (summary):

- Draft a 1–6 line update describing the change, date, and refs.
- For small updates to `/.ai/BACKLOG.md` or `/.ai/CURRENT.md`, Developer may make the change directly as part of the same focused implementation branch, without a separate docs-only PR.
- Open a branch `docs/current/<short-what>` and create a PR with title
	`docs(.ai): update CURRENT.md — YYYY-MM-DD` for larger strategy or architecture status changes.
- Add label `docs/.ai`, request Architect review when the update is more than a routine status note.
- Keep `CURRENT.md` short; move rationale to `DECISIONS.md`.

 See `.agents/architect.md` for the full step-by-step procedure and commit
 template.

Contact: this is a project-local playbook — modify by PR if you want to evolve it.
