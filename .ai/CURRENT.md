# Current Work

## Draft note (auto-generated) — 2026-07-27, via radius-sources-draft-note.sh

`RADIUS_SOURCES` changed in this commit:

```diff
@@ -162,7 +162,9 @@ def _apply_zone(center, zoom, radius_nm, zone_id):
     _active_zone_id = zone_id
 
     for _cfg in RADIUS_SOURCES.values():
-        _cfg["center"] = {"lat": AREA_CENTER["lat"], "lon": AREA_CENTER["lon"], _cfg["dist_param"]: AREA_RADIUS_NM}
+        _cfg["center"] = {"lat": AREA_CENTER["lat"], "lon": AREA_CENTER["lon"]}
+        if _cfg.get("dist_param"):
+            _cfg["center"][_cfg["dist_param"]] = AREA_RADIUS_NM
 
     FLIGHTAWARE_QUERY = '-latlong "{lamin} {lomin} {lamax} {lomax}"'.format(**BBOX)
 
@@ -451,7 +453,9 @@ _load_track_cache()
 # BBOX above. NOTE: as of 2026-07-17 api.adsb.one sits behind a Cloudflare
 # WAF that 403s server-side requests, so its proxy will return an empty list
 # until that's lifted; the pipeline tolerates a dataless source by design.
-# Adding a fifth is one dict entry plus a one-line alias route below.
+# aircraftscatter is the exception: its paid RapidAPI endpoint has a fixed
+# 1,000km search radius and only takes a center point, so it is opt-in and
+# cached longer to remain comfortably below its 60,000-request monthly plan.
 RADIUS_SOURCES = {
     # "dist_param" is the query field name each API uses for the radius —
     # adsb.fi/adsb.lol call it "dist", adsb.one/airplanes.live call it
@@ -478,7 +486,9 @@ RADIUS_SOURCES = {
     },
 }
 for _cfg in RADIUS_SOURCES.values():
-    _cfg["center"] = {"lat": AREA_CENTER["lat"], "lon": AREA_CENTER["lon"], _cfg["dist_param"]: AREA_RADIUS_NM}
+    _cfg["center"] = {"lat": AREA_CENTER["lat"], "lon": AREA_CENTER["lon"]}
+    if _cfg.get("dist_param"):
+        _cfg["center"][_cfg["dist_param"]] = AREA_RADIUS_NM
     _cfg["cache"] = {"data": None, "ts": 0.0}
 del _cfg
 
@@ -488,6 +498,7 @@ del _cfg
 # through .clear()/.update() is visible through the other.
 _adsbfi_cache = RADIUS_SOURCES["adsbfi"]["cache"]
 _airplaneslive_cache = RADIUS_SOURCES["airplaneslive"]["cache"]
+_aircraftscatter_cache = RADIUS_SOURCES["aircraftscatter"]["cache"]
 _adsblol_cache = RADIUS_SOURCES["adsblol"]["cache"]
 _adsbone_cache = RADIUS_SOURCES["adsbone"]["cache"]
 
@@ -942,7 +954,18 @@ def cached_radius_source(url, cache, min_interval, headers=None, params=None, em
 def radius_source_response(name):
     _maybe_reload_zone_from_disk()
     cfg = RADIUS_SOURCES[name]
-    return cached_radius_source(cfg["url"].format(**cfg["center"]), cfg["cache"], cfg["min_interval"])
+    if name == "aircraftscatter":
+        if not RAPIDAPI_KEY:
+            return jsonify({"ac": [], "error": "not_configured"})
+        headers = {
+            "X-RapidAPI-Host": "aircraftscatter.p.rapidapi.com",
+            "X-RapidAPI-Key": RAPIDAPI_KEY,
+        }
+    else:
+        headers = None
+    return cached_radius_source(
+        cfg["url"].format(**cfg["center"]), cfg["cache"], cfg["min_interval"], headers=headers,
+    )
 
 
 @app.route("/api/source/<name>")
```

_Auto-generated — replace with a real summary (or delete if this note is
redundant with a change already described elsewhere) before the next
commit touching this file._


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

---

*No active work items as of 2026-07-22. Workflow & Branching Convention documented in CLAUDE.md.*
