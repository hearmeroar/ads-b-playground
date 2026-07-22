# Proposal: Adopt a mature UI framework (Bootstrap / Bulma / MDC / Tailwind)

**Date:** 2026-07-22  
**Status:** Design discussion, decision pending  
**Effort:** M (research phase: POC + decision; actual adoption TBD)  
**Value:** High (unblocks 10× faster component addition, consistency, maintainability)

## Problem Statement

Currently, **every UI component is written from scratch** in vanilla CSS — buttons, inputs, dropdowns, modals, tables, form controls, etc. This works at small scale (50 components), but as the app grows, we're repeating patterns and making micro-decisions per-component instead of leveraging a unified design system.

**Pain points:**
- No single source of truth for spacing, typography, colors, animations
- New components require custom CSS; easy to violate existing patterns
- Design consistency is maintained by eye, not by a spec
- Accessibility, dark mode support, responsive breakpoints are ad-hoc per control
- Customization is hard (changing a color means finding every `.css` rule by hand)

**User's vision** (stated explicitly): *"я хочу взять готовую раму со структурой и кастомизировать ее. так можно сразу выбрать базовый стиль"* — we want a ready-made frame with structure and the freedom to customize it, not build a design system from scratch.

## Candidate Frameworks (Quick Comparison)

| Framework | Components | Build Step? | CSS Vars | Customization | Notes |
|-----------|---|---|---|---|---|
| **Bootstrap** | 50+ | CSS vars ✓ | Excellent | Very good | Mature, heavy, but vanilla CSS option exists. Industry standard. |
| **Bulma** | 30+ | SCSS/vars | Good | Good | Cleaner than Bootstrap, lighter, less "overengineered" feel. |
| **Material Design (MDC)** | 60+ | Partial | Good | Good | From Google, modern. Some JS for interactivity. Web Components variant. |
| **UIKit** | 40+ | SCSS/vars | Good | Excellent | Minimal, flexible, great for vanilla setups. Less known. |
| **Pico CSS** | 15+ | No | Limited | Limited | Too minimal for our "100500 variants" requirement. |
| **Tailwind** | Unlimited (utility-first) | PostCSS ✓ | Yes | Very flexible | De-facto standard now. But requires build step. |
| **UnoCSS** | Unlimited | Build step | Yes | Very flexible | Lighter Tailwind alternative. Still requires build. |

## Constraints (Non-Negotiable)

1. **No framework** — the app uses vanilla JS, no React/Vue/Angular. Any framework must output plain HTML + CSS + minimal JS.
2. **No build step** (soft constraint) — the app currently ships with `<link>` and `<script>` tags, no build pipeline. A mature framework might force one; this is a tradeoff point worth discussing.
3. **Customizable** — the chosen framework must allow theming (colors, spacing, typography) without forking the whole library.
4. **Accessible** — WCAG 2.1 AA as a baseline (dark mode, keyboard nav, ARIA).

## UI's Perspective

> *"Текущий подход (каждый контрол пишешь сам) работает на 50 компонентах, но на 200 это nightmare. Нужен mature framework с 100500 вариантов, который ты потом кастомизируешь под себя."*

**Translation:** The current approach (writing each control by hand) works at 50 components, but at 200 it becomes unmaintainable. We need a mature framework with tons of pre-built variants, which we then customize to our brand. This is about **speed + consistency**, not "design by committee."

## Architect's Perspective

This is an **architectural decision**, not a feature. It affects:
- **How new UI code is written** (do we use the framework's components, or keep mixing vanilla?)
- **The build pipeline** (if we pick Tailwind, we accept a PostCSS build step; if Bootstrap/Bulma, we don't)
- **Customization layer** (CSS variables, SCSS mixins, or utility-first approach?)
- **Deployment & bundle size** (Bootstrap is ~150KB, Tailwind is ~60KB post-purge, but requires build)

**Recommendation:** Research phase first. Pick one framework, build a POC (e.g., one existing page using the framework's components), report on:
1. **Customization ease** — how hard is theming to our brand?
2. **Build-step cost** — if we choose Tailwind, what's the CI/build friction?
3. **Adoption friction** — how much existing vanilla CSS needs rewriting?
4. **Constraints** — does it force anything incompatible with our current setup (classic script tags, load order)?

## Proposed Research Phase

1. **Pick a champion framework** (Architect + UI consensus):
   - If "no build step" is hard constraint → Bootstrap / Bulma / MDC / UIKit
   - If "build step is acceptable" → Tailwind (easier customization, smaller bundle)
   - User to decide based on appetite for build complexity

2. **Build a tiny POC** (~2 hours):
   - Fork/branch with one page using the framework's components (e.g., the HUD panel or sidebar)
   - Theme it to our current brand (blue/gray palette, sans-serif typography)
   - Report: did it feel natural? Was customization straightforward?

3. **Measure migration cost**:
   - How many existing CSS rules need reworking?
   - Is the framework's default styling close to ours, or do we diverge everywhere?
   - Can we adopt incrementally (new components use the framework, old ones stay vanilla) or is it all-or-nothing?

4. **Decision**: proceed to adoption phase (full migration), defer to "later" (stay vanilla for now), or hybrid (framework for new components, vanilla for legacy).

## Success Criteria (For Research Phase)

- [ ] Pick one framework (decision made by 2026-07-29)
- [ ] POC branch created with one page re-implemented using the framework
- [ ] Customization report written (e.g., "theming took 30 mins, here's the config file")
- [ ] Team consensus on whether to adopt, defer, or hybrid approach
- [ ] Decision logged as an ADR in `.ai/DECISIONS.md`

## Non-Recommendations

- **Don't adopt "design tokens" libraries** (like Open Props, System.css) as a substitute. Those are building blocks, not frameworks — they give you variables but not pre-built components. We need the components.
- **Don't pick based on popularity alone.** Tailwind is trendy, but if "no build step" is a hard line, Bootstrap/Bulma/MDC are the right trade-offs.
- **Don't migrate the whole codebase immediately.** If we decide to adopt, do it incrementally (new pages/panels first, then refactor old ones).

## Next Steps

1. **Architect** convenes with User to pick a champion framework for research.
2. **Developer** builds a POC branch (2–3 hours).
3. **UI** reviews the POC's customization and aesthetic fit.
4. **Architect** logs the research findings and the decision (adopt / defer / hybrid) as an ADR.

---

**Context & Discussion:** This proposal emerged from a conversation where the user expressed frustration with ad-hoc component styling and asked for a mature, pre-built framework rather than designing a system from scratch. The team (UI, Architect, Developer) aligned that this is a sound investment for future maintainability and speed, but agreed that the *choice* of framework depends on whether we accept a build step (Tailwind, easier customization) or stay pure vanilla (Bootstrap/Bulma/MDC, harder but possible). Research phase will clarify that tradeoff and report back.

