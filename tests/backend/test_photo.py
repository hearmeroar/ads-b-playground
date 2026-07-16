import requests

import app
from conftest import make_response


def test_happy_path_by_registration(client, mock_get):
    mock_get.return_value = make_response(json_data={"photos": [{"id": "1", "photographer": "X"}]})
    resp = client.get("/api/photo/reg/D-ABCD")
    assert resp.status_code == 200
    assert resp.get_json()["photos"][0]["photographer"] == "X"


def test_hex_lookup(client, mock_get):
    mock_get.return_value = make_response(json_data={"photos": [{"id": "2"}]})
    resp = client.get("/api/photo/hex/4bc8c5")
    assert resp.status_code == 200
    assert resp.get_json()["photos"][0]["id"] == "2"


def test_empty_photos_still_200(client, mock_get):
    mock_get.return_value = make_response(json_data={"photos": []})
    resp = client.get("/api/photo/reg/ZZ-NOPE")
    assert resp.status_code == 200
    assert resp.get_json()["photos"] == []


def test_cache_never_expires(client, mock_get):
    mock_get.return_value = make_response(json_data={"photos": [{"id": "1"}]})
    client.get("/api/photo/reg/D-ABCD")
    # No time-based expiry exists for photos at all (unlike the live-data
    # caches) — a second call, however much later, must not re-fetch.
    app._photo_cache["reg:D-ABCD"]  # sanity: cache actually has the entry
    resp2 = client.get("/api/photo/reg/D-ABCD")
    assert mock_get.call_count == 1
    assert resp2.get_json()["photos"][0]["id"] == "1"


def test_sends_descriptive_user_agent(client, mock_get):
    mock_get.return_value = make_response(json_data={"photos": []})
    client.get("/api/photo/reg/D-ABCD")
    _, kwargs = mock_get.call_args
    ua = kwargs["headers"]["User-Agent"]
    assert "@" in ua or "http" in ua  # Planespotters requires a contact URL/email


def test_network_error_returns_502(client, mock_get):
    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/photo/reg/D-ABCD")
    assert resp.status_code == 502
