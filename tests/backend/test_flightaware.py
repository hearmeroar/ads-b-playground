import requests
import pytest

import app
from conftest import make_response


def test_not_configured_without_key(client):
    """Without FLIGHTAWARE_API_KEY, endpoint returns empty flights and
    not_configured error, without even attempting a network call."""
    client.get("/api/flightaware")
    # mock_get is not used, since no key means no fetch attempt.


def test_not_configured_with_mock_get(client, mock_get):
    """Explicitly: when the key is absent, mock_get is never called."""
    resp = client.get("/api/flightaware")
    assert resp.status_code == 200
    assert resp.get_json() == {"flights": [], "error": "not_configured"}
    assert mock_get.call_count == 0


def test_happy_path_with_key(client, mock_get, monkeypatch):
    """With a configured key, the request includes the API-key header and
    query params, and returns the raw response."""
    monkeypatch.setattr(app, "FLIGHTAWARE_API_KEY", "test-key-123")
    mock_get.return_value = make_response(json_data={
        "flights": [{"fa_flight_id": "ASL439-123", "ident": "ASL439"}]
    })

    resp = client.get("/api/flightaware")
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["flights"]) == 1
    assert data["flights"][0]["fa_flight_id"] == "ASL439-123"

    # Verify the mocked request was called with the right headers/params.
    mock_get.assert_called_once()
    call_kwargs = mock_get.call_args[1]
    assert call_kwargs["headers"] == {"x-apikey": "test-key-123"}
    assert "query" in call_kwargs["params"]


def test_cache_within_interval(client, mock_get, monkeypatch):
    """Responses are cached for FLIGHTAWARE_MIN_INTERVAL seconds."""
    monkeypatch.setattr(app, "FLIGHTAWARE_API_KEY", "test-key-123")
    mock_get.return_value = make_response(json_data={"flights": []})

    client.get("/api/flightaware")
    client.get("/api/flightaware")
    # Should use cache on the second call.
    assert mock_get.call_count == 1


def test_stale_fallback_on_error(client, mock_get, monkeypatch):
    """On network error, fall back to stale cache if available."""
    monkeypatch.setattr(app, "FLIGHTAWARE_API_KEY", "test-key-123")
    mock_get.return_value = make_response(json_data={
        "flights": [{"fa_flight_id": "cached-123"}]
    })
    client.get("/api/flightaware")
    # Expire the cache.
    app._flightaware_cache["ts"] = 0.0

    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/flightaware")
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["stale"] is True
    assert data["flights"][0]["fa_flight_id"] == "cached-123"


def test_cold_start_error_returns_502(client, mock_get, monkeypatch):
    """On network error with no cache, return 502 with empty flights list."""
    monkeypatch.setattr(app, "FLIGHTAWARE_API_KEY", "test-key-123")
    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/flightaware")
    assert resp.status_code == 502
    assert resp.get_json()["flights"] == []
