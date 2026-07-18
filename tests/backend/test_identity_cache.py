import json

import app
from conftest import make_response

AIRCRAFT_V1 = {
    "type": "G650 ER",
    "icao_type": "G650",
    "manufacturer": "Gulfstream Aerospace",
    "registration": "N628TS",
    "registered_owner": "Falcon Landing LLC",
}


def _read_history(path):
    try:
        with open(path) as f:
            return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        return []


def test_fresh_fetch_populates_identity_cache(client, mock_get):
    mock_get.return_value = make_response(json_data={"response": {"aircraft": AIRCRAFT_V1}})
    client.get("/api/adsbdb/a835af")

    entry = app._identity_cache["a835af"]
    assert entry["registration"] == "N628TS"
    assert entry["manufacturer"] == "Gulfstream Aerospace"
    assert entry["type"] == "G650 ER"
    assert entry["registered_owner"] == "Falcon Landing LLC"
    assert "updated_ts" in entry


def test_changed_field_is_logged_and_updated(client, mock_get):
    mock_get.return_value = make_response(json_data={"response": {"aircraft": AIRCRAFT_V1}})
    client.get("/api/adsbdb/a835af")

    changed = dict(AIRCRAFT_V1, registration="N999ZZ")
    mock_get.return_value = make_response(json_data={"response": {"aircraft": changed}})
    # Different callsign -> different _adsbdb_cache key, so this is a fresh
    # upstream fetch rather than served from the existing cache entry.
    client.get("/api/adsbdb/a835af?callsign=TEST123")

    assert app._identity_cache["a835af"]["registration"] == "N999ZZ"
    history = _read_history(app.IDENTITY_HISTORY_FILE)
    assert len(history) == 1
    assert history[0] == {
        "icao24": "a835af", "field": "registration",
        "old": "N628TS", "new": "N999ZZ", "ts": history[0]["ts"],
    }


def test_null_field_does_not_erase_known_value(client, mock_get):
    mock_get.return_value = make_response(json_data={"response": {"aircraft": AIRCRAFT_V1}})
    client.get("/api/adsbdb/a835af")

    partial = dict(AIRCRAFT_V1, registered_owner=None)
    mock_get.return_value = make_response(json_data={"response": {"aircraft": partial}})
    client.get("/api/adsbdb/a835af?callsign=TEST123")

    assert app._identity_cache["a835af"]["registered_owner"] == "Falcon Landing LLC"
    history = _read_history(app.IDENTITY_HISTORY_FILE)
    assert history == []


def test_identity_cache_persists_to_disk(client, mock_get):
    mock_get.return_value = make_response(json_data={"response": {"aircraft": AIRCRAFT_V1}})
    client.get("/api/adsbdb/a835af")

    with open(app.IDENTITY_CACHE_FILE) as f:
        stored = json.load(f)
    assert stored["a835af"]["registration"] == "N628TS"


def test_identity_cache_survives_restart_via_disk(client, mock_get):
    mock_get.return_value = make_response(json_data={"response": {"aircraft": AIRCRAFT_V1}})
    client.get("/api/adsbdb/a835af")

    app._identity_cache.clear()
    app._load_identity_cache()
    assert app._identity_cache["a835af"]["registration"] == "N628TS"


def test_no_identity_update_on_unknown_aircraft(client, mock_get):
    mock_get.return_value = make_response(status_code=404)
    client.get("/api/adsbdb/deadbe")
    assert "deadbe" not in app._identity_cache


def test_identity_stats_endpoint(client, mock_get):
    resp = client.get("/api/identity/stats")
    assert resp.status_code == 200
    assert resp.get_json() == {"identity_count": 0, "history_count": 0}

    mock_get.return_value = make_response(json_data={"response": {"aircraft": AIRCRAFT_V1}})
    client.get("/api/adsbdb/a835af")
    changed = dict(AIRCRAFT_V1, registration="N999ZZ")
    mock_get.return_value = make_response(json_data={"response": {"aircraft": changed}})
    client.get("/api/adsbdb/a835af?callsign=TEST123")

    resp = client.get("/api/identity/stats")
    assert resp.get_json() == {"identity_count": 1, "history_count": 1}
