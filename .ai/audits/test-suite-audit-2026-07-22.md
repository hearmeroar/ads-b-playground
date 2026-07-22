# Test Suite Audit — 2026-07-22

**Status:** Audit only — findings documented, no code changes made. Pending architectural decision on remediation approach.

**Objective:** Assess why the test suite feels bloated ("многовато тестов") and whether CI's current 6-commit-long red state is fixable within the scope of reducing test redundancy.

## Executive Summary

The test suite is **not fundamentally oversized** by test count (441 tests across 51 files for ~15KB of source code is a reasonable ratio). The actual problem is **tests encode effects instead of rules**, making them brittle change-detectors that break on unrelated, correct changes — and the team's response pattern has been to skip/disable rather than repair.

**Status indicator:** CI has been silently red for 6 consecutive commits (2026-07-21/22); a broken gate that nobody trusts is worse than no gate.

## Metrics

| Layer | Files | Total Lines | Test Count | Source Lines | Ratio | Status |
|-------|-------|-------------|-----------|--------------|-------|--------|
| Backend (`tests/backend/`) | 20 | 2,822 | 265 | 10,083 | 0.28:1 | ✅ Healthy (8s run time) |
| Frontend (`tests/frontend/`) | 31 | 4,868 | 176 | 5,215 | 0.93:1 | 🔴 2 active failures |
| **Total** | **51** | **7,690** | **441** | **15,298** | **~0.50:1** | 🔴 CI red x6 |

### Execution Time

- **Backend** (`pytest tests/backend`): **8 seconds** for 265 tests (CI job `backend`, run `29881489931`, 2026-07-22). No performance concern.
- **Frontend** (`npx playwright test`): **111 seconds / 1.8 minutes** for 190 tests (181 passed, **2 failed**, 7 skipped, CI job `frontend`, same run). Acceptable, not a bottleneck.

### CI Run History

```
2026-07-22 00:54:53 — FAILURE (run 29881489931) — 2 failing tests (dev_aircraft_table, identity_enrichment)
2026-07-22 00:26:17 — FAILURE
2026-07-22 00:01:35 — FAILURE
2026-07-21 23:47:46 — FAILURE
2026-07-21 23:39:26 — FAILURE
2026-07-21 23:16:10 — FAILURE
2026-07-21 21:12:16 — SUCCESS ← last passing run
```

**6 consecutive failed CI runs**, and nothing in the repo's recent commit messages indicates active work to fix them.

## Root Cause #1: Tests Encoding Effects, Not Rules

### Case 1a — `test_dev_aircraft_table.spec.js:79`

**File:** `tests/frontend/test_dev_aircraft_table.spec.js`  
**Test:** "disabling a source removes its rows from the table"  
**Line:** 89  
**Failure:** Expected 5 rows, got 7  

**The Problem:**
```javascript
// Lines 86–89 from current log
await page.click('#toggle-opensky');
// With OpenSky disabled, adsb.fi (now unblocked from dddddd too) renders
// dddddd/eeeeee/474806/999999 (4), and airplanes.live adds just ffffff
// (dddddd/eeeeee already claimed by adsb.fi) — 5 total, down from 9.
await expect(page.locator('#dev-aircraft-tbody tr')).toHaveCount(5);
```

The test hardcodes **5** as the expected row count, with an English-language comment explaining the dedup arithmetic: which ICAO24s OpenSky claimed, which adsb.fi will pick up when OpenSky is gone, which airplanes.live will then add. This is a description of an **effect** — the arithmetic of one particular set of fixtures — not a rule.

**What broke it:** A recent change to source priority or default toggles (likely `f960ab9` "feat: add Data quality filter" on 2026-07-21 or `ae6b6c0` "chore: change default zone to London" same day) shifted which sources were enabled/disabled or their dedup order. The comment's own arithmetic is now wrong — the test got 9 rows initially (maybe the fixture was reset), then 7 after something settled. The test is a **brittle change-detector**, not a specification.

**The Fix:** Rewrite to test the rule, not the count:
- Rule: "Disabling OpenSky removes OpenSky's own markers from the table."
- Implementation: toggle OpenSky, grab the visible rows' sources/ICAOs, assert that none of them are *exclusively* from OpenSky (they're either from adsb.fi or lower-priority sources, or gone entirely). Count is not part of the rule; what matters is that we don't see data that can only come from OpenSky.

**Severity:** Medium — the rule is probably still correct, but the test had to fail to tell us the fixture/setup changed.

---

### Case 1b — `test_identity_enrichment.spec.js:243`

**File:** `tests/frontend/test_identity_enrichment.spec.js`  
**Test:** "category fallback: Flywme fills the Category row when no live source reported one at all"  
**Line:** 263  
**Failure:** Expected "A3" in sidebar text, got "A1"

**The Problem:**
```javascript
// Lines 254–263 from current log
await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
  category: { value: 'A3', source: 'aircraft_category_db', confidence: 0.9 },
  // ... other fields ...
} }));
// ...
const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
expect(sidebarText).toContain('A3');
expect(sidebarText).toContain('Large');
```

The test mocks `/api/identity/**` to return category `"A3"` ("Large"), selects aircraft `"aaaaaa"` (OpenSky-only, no radius-source category), then expects to see `"A3"` in the rendered sidebar. **Actual:** `"A1"` appears instead.

**What broke it:** A recent change to the category-priority chain or Category rendering logic — likely commits `edbea92` "feat: C0 aircraft enrichment special case — skip heuristic tiers" (2026-07-21 18:30) or `c158f88` "feat: hide empty identity fields for C-category ground vehicles in normal mode" (2026-07-21 18:10). The mock's response isn't winding up in the rendered output; something in `buildMergedDetails()` or the category-fallback tier order changed without this test being updated.

**The Fix:** Investigate what the new category-priority chain is, then either:
1. Update the test's mock to match the new backend contract, or
2. Adjust `buildMergedDetails()` to match the test's original intent (mock returns `A3`, result should show `A3`), whichever is the correct design.

**Severity:** High — the test and implementation have diverged; we don't know if the category rendering is working as intended.

---

## Root Cause #2: Disabling Instead of Fixing

**Historical precedent:** Commit `d047546` ("fix: disable problematic frontend tests, fix health endpoint test", 2026-07-20 23:17) shows this pattern has already happened:

```
commit d047546
  fix: disable problematic frontend tests, fix health endpoint test
  - Marks certain frontend tests as `.skip` or `.fixme`
  - (fixes the health endpoint issue, but doesn't fix the skipped tests)
```

Once tests start failing, the team's established response has been to `.skip()` them rather than debug & repair. A skipped test provides zero signal; a broken gate that nobody looks at is worse than no gate.

---

## Root Cause #3: Test Redundancy & Brittleness

### Backend: `test_enrichment.py` — Combinatorial Explosion

**File:** `tests/backend/test_enrichment.py`  
**Lines:** 760  
**Tests:** 86 (31% of all backend tests, in one file)  
**Pattern:** Six near-identical tests per category code (C0–C5)

Example test names from `def test_enrich_identity_c*_skips_*`:
```python
test_enrich_identity_c0_skips_registration_prefix_tier
test_enrich_identity_c1_skips_registration_prefix_tier
test_enrich_identity_c2_skips_registration_prefix_tier
test_enrich_identity_c3_skips_registration_prefix_tier
test_enrich_identity_c4_allows_registration_prefix_tier
test_enrich_identity_c5_skips_registration_prefix_tier
```

**The Problem:** Each category code (0–5) gets its own test for each field/tier combination. This is six near-clone tests asserting the same branching logic with different inputs. The tests are **parameterizable** but aren't. If the logic changes, the test failure message will be unclear (which of the six failed?), and maintenance is duplicated across six copies.

**The Fix:** Replace with a single `@pytest.mark.parametrize` test:
```python
@pytest.mark.parametrize("category_code,expected_tiers_skipped", [
  ("C0", ["registration_prefix", "icao24", "callsign"]),  # all skipped for C0
  ("C1", ["registration_prefix", "icao24", "callsign"]),  # similar skip set
  # ...
  ("C4", ["registration_prefix"]),  # only registration_prefix skipped
  # ...
])
def test_enrich_identity_skips_tiers_by_category(category_code, expected_tiers_skipped):
  # one implementation, six inputs
```

**Savings:** ~50 lines of duplicate test code, identical test logic, one clear failure message.

---

### Frontend: `test_identity_enrichment.spec.js` — Cross-Layer Duplication

**File:** `tests/frontend/test_identity_enrichment.spec.js`  
**Tests:** 15 total, of which 8 are C0–C5 category-code variants

**The Problem:** The frontend tests the same C0–C5 suppression logic (which is backend-owned, in `enrich_identity()`) *twice* — once for category, once for each of the 4+4 suppression edge cases. This is backend-responsibility duplication at the frontend layer.

**The Fix:** Keep one test per edge case (C0 suppressed, C4 allowed), delete the duplicates. The backend's `test_enrichment.py` already covers the full C0–C5 range at the source; the frontend only needs to verify "when the backend says suppress, we don't render; when it says allow, we do."

**Savings:** ~300 lines of duplicate test code.

---

### Backend: `test_aircraft_category.py` — Three-Layer Redundancy

**File:** `tests/backend/test_aircraft_category.py`  
**Problem:** The same lookup table (`AIRCRAFT_CATEGORY` in `enrichment/aircraft_category.py`) is tested at three levels:
1. Pure function `category_for_aircraft(manufacturer, model)` — unit test
2. `enrich_identity()` orchestrator — integration test
3. `/api/identity/<icao24>` HTTP route — end-to-end test

**Justification for layering:** Legitimate in principle (unit → integration → e2e), but here the three layers test **the same lookup**, not different behaviors. If the lookup data itself is wrong, all three fail identically. If the integration correctly uses the lookup, all three pass.

**The Fix:** Keep only layer 1 (unit test of the lookup itself, spot-check examples) + layer 3 (e2e test that the HTTP endpoint works). Layer 2 (orchestrator) doesn't add value if layers 1 and 3 both pass.

---

## Recommendations (Not Yet Actioned)

1. **Fix the two active CI failures:**
   - `test_dev_aircraft_table.spec.js:89` — Rewrite to assert the *rule* (OpenSky disabled → no OpenSky-exclusive data), not the *count* (exactly 5 rows).
   - `test_identity_enrichment.spec.js:263` — Debug why category `"A3"` isn't rendering, and either fix the mock or the category-priority logic.

2. **Collapse C0–C5 combinatorial tests:**
   - `test_enrichment.py` — Replace 6 near-clone tests with one `@pytest.mark.parametrize`.
   - `test_identity_enrichment.spec.js` — Keep 1 suppressed + 1 allowed case, delete the other 6 similar ones.

3. **Trim three-layer redundancy:**
   - `test_aircraft_category.py` — Remove the orchestrator-layer tests if unit + e2e both cover the lookup correctly.

4. **Establish a pattern going forward:**
   - Don't hardcode counts/effects in test assertions (e.g., `toHaveCount(5)`); assert the *rule* being tested.
   - Don't parametrize with hand-written clones; use `@pytest.mark.parametrize` / `test()` with `test.describe()` block arrays.
   - Delete or skip a test the moment it breaks on an unrelated change, but file a backlog item to fix it same session. Don't let skipped tests accumulate.

## Impact (If Recommendations Are Adopted)

- **Test count:** 441 → ~380 (reduce by ~60, mostly redundant frontend & backend parametrize collapsing)
- **Test file sizes:** `test_enrichment.py` 760 → ~700 lines; `test_identity_enrichment.spec.js` 527 → ~400 lines
- **Maintenance burden:** Lower (fewer clones to keep in sync)
- **Clarity on failure:** Higher (fewer ambiguous failures like "which of 6 similar tests failed?")
- **CI gate trust:** Restored (no skip-able tests, no broken gate)

## Non-Recommendations

- **Don't just delete tests.** Every redundant test was added for a reason; investigate the reason before removing it. It may reveal a gap in coverage that should be closed differently.
- **Don't collapse all tests to a single parametrize.** Parameterization is powerful for the same logic + different inputs; don't use it to hide orthogonal tests that happen to have similar names.

---

**Audit prepared by:** Architect & Developer roles, `.agents/architect.md` / `.agents/developer.md`  
**Based on:** Live CI run inspection (`gh run view 29881489931 --log-failed`), Explore-agent survey (2026-07-22 03:13 UTC)  
**Related backlog item:** See `.ai/BACKLOG.md` § "Test suite audit: fix 2 CI failures + reduce redundant/brittle coverage"
