"""Zone mutation (_apply_zone(), /api/zones/active) and the cross-worker
sync mechanism (_maybe_reload_zone_from_disk()) — see app.py's _apply_zone()
docstring and CLAUDE.md's Airports/zone section for why a zone change has to
touch more than AREA_CENTER/BBOX: RADIUS_SOURCES[*]["center"],
FLIGHTAWARE_QUERY, and FLIGHTRADAR24_BOUNDS are all frozen at import time and
never revisited unless _apply_zone() explicitly recomputes them too. This is
the regression these tests exist to catch — assertions on those three values
specifically, not just on AREA_CENTER.

conftest.py's reset_caches fixture redirects ZONES_FILE to a throwaway file
and restores the pre-test zone afterward, so these tests never touch the
repo's real config/zones.json and never leak zone state into other test
files.
"""

import json
import os

import app


LONDON_HEATHROW = {"lat": 51.470748, "lon": -0.459909}


def test_apply_zone_updates_area_center_and_bbox():
    app._apply_zone(LONDON_HEATHROW, 9, 150, "EGLL")
    assert app.AREA_CENTER == {"lat": LONDON_HEATHROW["lat"], "lon": LONDON_HEATHROW["lon"]}
    assert app.AREA_ZOOM == 9
    assert app.AREA_RADIUS_NM == 150
    assert app._active_zone_id == "EGLL"
    assert app.BBOX["lamin"] == LONDON_HEATHROW["lat"] - app.BBOX_HALF_HEIGHT_DEG
    assert app.BBOX["lamax"] == LONDON_HEATHROW["lat"] + app.BBOX_HALF_HEIGHT_DEG
    assert app.AREA_RADIUS_KM == 150 * 1.852


def test_apply_zone_updates_radius_sources_centers():
    # The regression this feature exists to prevent: without _apply_zone()
    # explicitly rewriting these, the four radius sources would keep
    # querying the *old* location forever after a zone change.
    original_centers = {name: dict(cfg["center"]) for name, cfg in app.RADIUS_SOURCES.items()}
    app._apply_zone(LONDON_HEATHROW, app.AREA_ZOOM, app.AREA_RADIUS_NM, "EGLL")
    for name, cfg in app.RADIUS_SOURCES.items():
        assert cfg["center"]["lat"] == LONDON_HEATHROW["lat"]
        assert cfg["center"]["lon"] == LONDON_HEATHROW["lon"]
        assert cfg["center"] != original_centers[name]


def test_apply_zone_updates_flightaware_query():
    original_query = app.FLIGHTAWARE_QUERY
    app._apply_zone(LONDON_HEATHROW, app.AREA_ZOOM, app.AREA_RADIUS_NM, "EGLL")
    assert app.FLIGHTAWARE_QUERY != original_query
    assert str(LONDON_HEATHROW["lat"] - app.BBOX_HALF_HEIGHT_DEG) in app.FLIGHTAWARE_QUERY


def test_apply_zone_updates_flightradar24_bounds(monkeypatch):
    calls = []

    def fake_get_bounds(box):
        calls.append(box)
        return "fake-bounds-string"

    monkeypatch.setattr(app._fr24_client, "get_bounds", fake_get_bounds)
    original_bounds = app.FLIGHTRADAR24_BOUNDS
    app._apply_zone(LONDON_HEATHROW, app.AREA_ZOOM, app.AREA_RADIUS_NM, "EGLL")
    assert calls, "get_bounds() must be re-called on every zone change"
    assert app.FLIGHTRADAR24_BOUNDS == "fake-bounds-string"
    assert app.FLIGHTRADAR24_BOUNDS != original_bounds


def test_apply_zone_survives_flightradar24_failure(monkeypatch):
    # cached_flightradar24() elsewhere in this file already tolerates a bare
    # Exception from the FlightRadar24 SDK (see its own tests) — _apply_zone()
    # must degrade the same way: keep the old bounds rather than raising and
    # aborting the rest of the zone change.
    def failing_get_bounds(box):
        raise RuntimeError("FlightRadar24 blocked this process")

    monkeypatch.setattr(app._fr24_client, "get_bounds", failing_get_bounds)
    original_bounds = app.FLIGHTRADAR24_BOUNDS
    app._apply_zone(LONDON_HEATHROW, app.AREA_ZOOM, app.AREA_RADIUS_NM, "EGLL")
    assert app.FLIGHTRADAR24_BOUNDS == original_bounds
    assert app.AREA_CENTER == {"lat": LONDON_HEATHROW["lat"], "lon": LONDON_HEATHROW["lon"]}


def test_apply_zone_clears_location_scoped_caches():
    app._cache.update({"data": {"states": []}, "ts": 123.0})
    for cfg in app.RADIUS_SOURCES.values():
        cfg["cache"].update({"data": {"ac": []}, "ts": 123.0})
    app._flightaware_cache.update({"data": {"flights": []}, "ts": 123.0})
    app._flightradar24_cache.update({"data": {"flights": []}, "ts": 123.0})
    app._metar_cache.update({"data": [], "ts": 123.0})
    app._sigmet_cache.update({"data": [], "ts": 123.0})

    app._apply_zone(LONDON_HEATHROW, app.AREA_ZOOM, app.AREA_RADIUS_NM, "EGLL")

    assert app._cache["data"] is None
    for cfg in app.RADIUS_SOURCES.values():
        assert cfg["cache"]["data"] is None
    assert app._flightaware_cache["data"] is None
    assert app._flightradar24_cache["data"] is None
    assert app._metar_cache["data"] is None
    assert app._sigmet_cache["data"] is None


# --- /api/zones/active route -------------------------------------------------

def test_api_zones_set_active_recomputes_config(client):
    resp = client.post("/api/zones/active", json={"lat": LONDON_HEATHROW["lat"], "lon": LONDON_HEATHROW["lon"], "zone_id": "EGLL"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["center"] == {"lat": LONDON_HEATHROW["lat"], "lon": LONDON_HEATHROW["lon"]}
    assert data["active_zone_id"] == "EGLL"

    config_resp = client.get("/api/config")
    assert config_resp.get_json()["center"] == {"lat": LONDON_HEATHROW["lat"], "lon": LONDON_HEATHROW["lon"]}


def test_api_zones_set_active_defaults_zone_id_to_custom(client):
    resp = client.post("/api/zones/active", json={"lat": 10.0, "lon": 20.0})
    assert resp.status_code == 200
    assert resp.get_json()["active_zone_id"] == "custom"


def test_api_zones_set_active_rejects_invalid_coordinates(client):
    for body in (
        {"lat": "not-a-number", "lon": 20.0},
        {"lat": 91.0, "lon": 20.0},
        {"lat": 44.0, "lon": 181.0},
        {"lat": None, "lon": 20.0},
        {},
    ):
        resp = client.post("/api/zones/active", json=body)
        assert resp.status_code == 400
        assert resp.get_json()["error"] == "invalid_coordinates"


def test_api_zones_set_active_persists_to_disk(client):
    resp = client.post("/api/zones/active", json={"lat": LONDON_HEATHROW["lat"], "lon": LONDON_HEATHROW["lon"], "zone_id": "EGLL"})
    assert resp.status_code == 200
    with open(app.ZONES_FILE) as f:
        cfg = json.load(f)
    assert cfg["active_zone_id"] == "EGLL"
    assert cfg["zones"]["EGLL"]["center"] == {"lat": LONDON_HEATHROW["lat"], "lon": LONDON_HEATHROW["lon"]}


# --- Cross-worker sync (_maybe_reload_zone_from_disk()) ---------------------

def test_maybe_reload_zone_from_disk_picks_up_external_change():
    # Simulates a *different* gunicorn worker having already applied and
    # persisted a zone change — this process's own globals must still be at
    # their pre-test values until _maybe_reload_zone_from_disk() runs.
    assert app.AREA_CENTER != {"lat": LONDON_HEATHROW["lat"], "lon": LONDON_HEATHROW["lon"]}

    with open(app.ZONES_FILE, "w") as f:
        json.dump({
            "active_zone_id": "EGLL",
            "zones": {"EGLL": {"center": LONDON_HEATHROW, "zoom": 9, "radius_nm": 150}},
        }, f)
    # Force the mtime forward in case the write above landed within the same
    # filesystem-timestamp granularity as the fixture's own initial write.
    new_mtime = os.path.getmtime(app.ZONES_FILE) + 1
    os.utime(app.ZONES_FILE, (new_mtime, new_mtime))

    app._maybe_reload_zone_from_disk()

    assert app.AREA_CENTER == {"lat": LONDON_HEATHROW["lat"], "lon": LONDON_HEATHROW["lon"]}
    assert app._active_zone_id == "EGLL"
    assert app.RADIUS_SOURCES["adsbfi"]["center"]["lat"] == LONDON_HEATHROW["lat"]


def test_maybe_reload_zone_from_disk_is_noop_without_file_change():
    original_center = dict(app.AREA_CENTER)
    app._maybe_reload_zone_from_disk()
    app._maybe_reload_zone_from_disk()
    assert app.AREA_CENTER == original_center


def test_api_config_picks_up_external_zone_change(client):
    # /api/config itself calls _maybe_reload_zone_from_disk() — a GET
    # against it must see a change another worker persisted, not just the
    # explicit test above calling the reload function directly.
    with open(app.ZONES_FILE, "w") as f:
        json.dump({
            "active_zone_id": "EGLL",
            "zones": {"EGLL": {"center": LONDON_HEATHROW, "zoom": 9, "radius_nm": 150}},
        }, f)
    new_mtime = os.path.getmtime(app.ZONES_FILE) + 1
    os.utime(app.ZONES_FILE, (new_mtime, new_mtime))

    resp = client.get("/api/config")
    assert resp.get_json()["center"] == {"lat": LONDON_HEATHROW["lat"], "lon": LONDON_HEATHROW["lon"]}
