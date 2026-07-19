import json
import time

import requests

import app
from conftest import make_response


def test_happy_path(client, mock_get):
    mock_get.return_value = make_response(json_data={"icao24": "abc123", "path": [[1, 2, 3]]})
    resp = client.get("/api/track/abc123")
    assert resp.status_code == 200
    assert resp.get_json()["path"] == [[1, 2, 3]]
    mock_get.assert_called_once()


def test_not_found_returns_404(client, mock_get):
    mock_get.return_value = make_response(status_code=404)
    resp = client.get("/api/track/deadbeef")
    assert resp.status_code == 404
    assert resp.get_json()["error"] == "not_found"


def test_cache_within_track_min_interval(client, mock_get):
    mock_get.return_value = make_response(json_data={"path": []})
    client.get("/api/track/abc123")
    client.get("/api/track/abc123")
    assert mock_get.call_count == 1


def test_rate_limited_falls_back_to_cache(client, mock_get):
    mock_get.return_value = make_response(json_data={"path": [["cached"]]})
    client.get("/api/track/abc123")
    app._track_cache["abc123"]["ts"] = 0.0

    mock_get.return_value = make_response(status_code=429)
    resp = client.get("/api/track/abc123")
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["stale"] is True
    assert data["error"] == "rate_limited"


def test_rate_limited_no_cache_returns_429(client, mock_get):
    mock_get.return_value = make_response(status_code=429, headers={
        "X-Rate-Limit-Remaining": "3968",
        "X-Rate-Limit-Retry-After-Seconds": "42",
    })
    resp = client.get("/api/track/neverseen")
    assert resp.status_code == 429
    assert resp.get_json() == {
        "error": "rate_limited",
        "path": [],
        "rate_limit_remaining": 3968,
        "retry_after_seconds": 42,
    }


def test_network_error_no_cache_returns_502(client, mock_get):
    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/track/xyz")
    assert resp.status_code == 502


def test_network_error_opens_outage_breaker_for_subsequent_requests(client, mock_get):
    mock_get.side_effect = requests.ConnectionError("boom")
    client.get("/api/track/xyz")
    assert mock_get.call_count == 1

    resp = client.get("/api/track/xyz")
    assert resp.status_code == 502
    assert resp.get_json()["error"] == "opensky_unreachable"
    mock_get.assert_called_once()  # second request didn't touch the network at all


def test_outage_breaker_is_shared_with_states_endpoint(client, mock_get):
    # /api/states and /api/track/<icao24> hit the same opensky-network.org
    # host, so a failure on one should back off the other too, not just
    # requests to the same route.
    mock_get.side_effect = requests.ConnectionError("boom")
    client.get("/api/states")
    assert mock_get.call_count == 1

    resp = client.get("/api/track/xyz")
    assert resp.status_code == 502
    assert resp.get_json()["error"] == "opensky_unreachable"
    mock_get.assert_called_once()  # track request also skipped the network


def test_successful_fetch_persists_to_disk(client, mock_get):
    mock_get.return_value = make_response(json_data={"path": [[1, 2, 3]]})
    client.get("/api/track/abc123")

    with open(app.TRACK_CACHE_FILE) as f:
        stored = json.load(f)
    assert "abc123" in stored
    assert stored["abc123"]["data"]["path"] == [[1, 2, 3]]


def test_cache_survives_restart_via_disk(client, mock_get):
    mock_get.return_value = make_response(json_data={"path": [[1, 2, 3]]})
    client.get("/api/track/abc123")
    assert mock_get.call_count == 1

    # Simulate a server restart: the in-memory dict is gone, but the file
    # remains and _load_track_cache() repopulates from it.
    app._track_cache.clear()
    app._load_track_cache()
    assert "abc123" in app._track_cache

    resp = client.get("/api/track/abc123")
    assert resp.status_code == 200
    assert resp.get_json()["path"] == [[1, 2, 3]]
    # Served from the restored cache — OpenSky was not hit a second time.
    assert mock_get.call_count == 1


def test_load_drops_entries_older_than_max_age(client, mock_get):
    mock_get.return_value = make_response(json_data={"path": [[1, 2, 3]]})
    client.get("/api/track/abc123")

    # Age the persisted entry past TRACK_CACHE_MAX_AGE, then reload.
    with open(app.TRACK_CACHE_FILE) as f:
        stored = json.load(f)
    stored["abc123"]["ts"] = time.time() - app.TRACK_CACHE_MAX_AGE - 1
    with open(app.TRACK_CACHE_FILE, "w") as f:
        json.dump(stored, f)

    app._track_cache.clear()
    app._load_track_cache()
    assert "abc123" not in app._track_cache
