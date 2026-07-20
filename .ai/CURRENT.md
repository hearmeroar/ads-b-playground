# Current Work

*(Updated after each significant session or task completion)*

## Status

✅ **Complete** — AI project memory system (`.ai/` layer) has been created, documented, and staged for review. All five files committed-ready, no app code changes.

**What was accomplished:**
1. Created `.ai/` directory with 5 files:
   - `PROJECT.md` — Overview, goals, hard constraints (~84 lines)
   - `ARCHITECTURE.md` — Current-state map (sources, modules, flow) (~161 lines)
   - `DECISIONS.md` — ADR log with 5 backfilled entries (~101 lines)
   - `CURRENT.md` — Active work status (this file, ~34 lines)
   - `BACKLOG.md` — Parked ideas/features (~43 lines)

2. Integrated into CLAUDE.md:
   - Added "## AI Memory System (.ai/)" section (lines 11–40)
   - Added `@.ai/PROJECT.md`, `@.ai/ARCHITECTURE.md`, `@.ai/CURRENT.md` includes (auto-loaded per session)
   - Added on-demand file instructions (DECISIONS.md, BACKLOG.md)
   - Documented pre-commit memory-update rules

3. Updated README.md:
   - Added pointer under "Project layout" describing `.ai/` purpose + link to CLAUDE.md section

4. Verified:
   - `git status` confirms `.ai/` is untracked (not gitignored) ✓
   - All 5 files present and properly formatted ✓
   - DECISIONS.md entries backfilled from real CLAUDE.md decisions ✓

## Next steps (for user)

**Status update (2026-07-20):** the lightweight agent guidance files were added to the repository and committed to `main` (`.agents/*`). The AI memory system itself remains as originally created under `.ai/`.

User can:
1. Review the new `.ai/` files and edits to CLAUDE.md/README.md (unchanged).
2. Review the added `.agents/` files in the repo (commit b10fb9f on `main`).
3. On next AI session, the memory system and `.agents/` guidance will be available for the agent to reference.

If you'd like, I can also keep `.ai/CURRENT.md` in-sync automatically after future in-repo changes (create/update entries and commit), or leave it human-updated only — tell me your preference.

## Known issues / future improvements

None identified. System is intentionally minimal and correct-by-design.

---

**Memory system is now in place and operational. PLAN_NOTES.md remains untouched (local, gitignored).**
