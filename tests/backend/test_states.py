import requests

import app
from conftest import make_response


def test_happy_path(client, mock_get):
    mock_get.return_value = make_response(
        json_data={"time": 1, "states": [["abc123", "TEST1", "Testland"]]},
        headers={"X-Rate-Limit-Remaining": "42"},
    )
    resp = client.get("/api/states")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["rate_limit_remaining"] == 42
    assert data["states"][0][0] == "abc123"
    mock_get.assert_called_once()


def test_cache_within_min_interval(client, mock_get):
    mock_get.return_value = make_response(json_data={"states": []})
    client.get("/api/states")
    client.get("/api/states")
    assert mock_get.call_count == 1


def test_rate_limited_falls_back_to_stale_cache(client, mock_get):
    mock_get.return_value = make_response(json_data={"states": [["cached"]]})
    client.get("/api/states")
    app._cache["ts"] = 0.0  # force the cache to be treated as expired

    mock_get.return_value = make_response(status_code=429)
    resp = client.get("/api/states")
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["stale"] is True
    assert data["error"] == "rate_limited"
    assert data["states"][0][0] == "cached"


def test_rate_limited_no_cache_returns_429(client, mock_get):
    mock_get.return_value = make_response(status_code=429)
    resp = client.get("/api/states")
    assert resp.status_code == 429
    assert resp.get_json()["error"] == "rate_limited"


def test_rate_limited_forwards_retry_after_seconds(client, mock_get):
    mock_get.return_value = make_response(status_code=429, headers={
        "X-Rate-Limit-Retry-After-Seconds": "10980",
    })
    resp = client.get("/api/states")
    assert resp.status_code == 429
    assert resp.get_json()["retry_after_seconds"] == 10980


def test_rate_limited_stale_cache_includes_retry_after(client, mock_get):
    mock_get.return_value = make_response(json_data={"states": [["cached"]]})
    client.get("/api/states")
    app._cache["ts"] = 0.0  # force the cache to be treated as expired

    mock_get.return_value = make_response(status_code=429, headers={
        "X-Rate-Limit-Retry-After-Seconds": "42",
    })
    resp = client.get("/api/states")
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["stale"] is True
    assert data["error"] == "rate_limited"
    assert data["retry_after_seconds"] == 42


def test_network_error_falls_back_to_stale_cache(client, mock_get):
    mock_get.return_value = make_response(json_data={"states": [["cached"]]})
    client.get("/api/states")
    app._cache["ts"] = 0.0

    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/states")
    data = resp.get_json()
    assert data["stale"] is True
    assert "boom" in data["error"]


def test_network_error_no_cache_returns_502(client, mock_get):
    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/states")
    assert resp.status_code == 502


def test_network_error_opens_outage_breaker_for_subsequent_requests(client, mock_get):
    # A real production incident (2026-07-19): opensky-network.org itself
    # was unreachable, and every incoming poll re-attempted the network call
    # (the cache timestamp is never bumped on failure) — each one blocking a
    # gunicorn thread for a full connect-timeout, which exhausted the thread
    # pool under concurrent load. After one failure, later requests within
    # the cooldown must skip the network call entirely.
    mock_get.side_effect = requests.ConnectionError("boom")
    client.get("/api/states")
    assert mock_get.call_count == 1

    resp = client.get("/api/states")
    assert resp.status_code == 502
    assert resp.get_json()["error"] == "opensky_unreachable"
    mock_get.assert_called_once()  # second request didn't touch the network at all


def test_outage_breaker_recovers_after_cooldown(client, mock_get, monkeypatch):
    mock_get.side_effect = requests.ConnectionError("boom")
    client.get("/api/states")
    assert mock_get.call_count == 1

    app._opensky_outage["until"] = 0.0  # simulate the cooldown having elapsed
    mock_get.side_effect = None
    mock_get.return_value = make_response(json_data={"states": [["recovered"]]})

    resp = client.get("/api/states")
    assert resp.status_code == 200
    assert resp.get_json()["states"][0][0] == "recovered"
    assert mock_get.call_count == 2
