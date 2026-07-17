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
