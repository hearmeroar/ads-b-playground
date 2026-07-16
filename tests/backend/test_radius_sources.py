import requests
import pytest

import app
from conftest import make_response

RADIUS_SOURCES = [
    ("/api/adsbfi", "_adsbfi_cache"),
    ("/api/airplaneslive", "_airplaneslive_cache"),
]


@pytest.mark.parametrize("endpoint,cache_attr", RADIUS_SOURCES)
def test_happy_path(client, mock_get, endpoint, cache_attr):
    mock_get.return_value = make_response(json_data={"ac": [{"hex": "abc"}]})
    resp = client.get(endpoint)
    assert resp.status_code == 200
    assert resp.get_json()["ac"][0]["hex"] == "abc"


@pytest.mark.parametrize("endpoint,cache_attr", RADIUS_SOURCES)
def test_cache_within_interval(client, mock_get, endpoint, cache_attr):
    mock_get.return_value = make_response(json_data={"ac": []})
    client.get(endpoint)
    client.get(endpoint)
    assert mock_get.call_count == 1


@pytest.mark.parametrize("endpoint,cache_attr", RADIUS_SOURCES)
def test_stale_fallback_on_error(client, mock_get, endpoint, cache_attr):
    mock_get.return_value = make_response(json_data={"ac": [{"hex": "cached"}]})
    client.get(endpoint)
    getattr(app, cache_attr)["ts"] = 0.0

    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get(endpoint)
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["stale"] is True
    assert data["ac"][0]["hex"] == "cached"


@pytest.mark.parametrize("endpoint,cache_attr", RADIUS_SOURCES)
def test_cold_start_error_returns_502(client, mock_get, endpoint, cache_attr):
    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get(endpoint)
    assert resp.status_code == 502
    assert resp.get_json()["ac"] == []
