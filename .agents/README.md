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

Contact: this is a project-local playbook — modify by PR if you want to evolve it.
