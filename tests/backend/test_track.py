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
    mock_get.return_value = make_response(status_code=429)
    resp = client.get("/api/track/neverseen")
    assert resp.status_code == 429


def test_network_error_no_cache_returns_502(client, mock_get):
    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/track/xyz")
    assert resp.status_code == 502
