import requests

import app
from conftest import make_response

AIRCRAFT = {
    "type": "G650 ER",
    "icao_type": "G650",
    "manufacturer": "Gulfstream Aerospace",
    "mode_s": "A835AF",
    "registration": "N628TS",
    "registered_owner_country_iso_name": "US",
    "registered_owner_country_name": "United States",
    "registered_owner_operator_flag_code": "G650",
    "registered_owner": "Falcon Landing LLC",
    "url_photo": "https://airport-data.com/images/aircraft/001/598/001598299.jpg",
    "url_photo_thumbnail": "https://airport-data.com/images/aircraft/thumbnails/001/598/001598299.jpg",
}

FLIGHTROUTE = {
    "callsign": "BAW123",
    "callsign_icao": "BAW123",
    "callsign_iata": "BA123",
    "airline": {
        "name": "British Airways",
        "icao": "BAW",
        "iata": "BA",
        "country": "United Kingdom",
        "country_iso": "GB",
        "callsign": "SPEEDBIRD",
    },
    "origin": {
        "country_iso_name": "GB",
        "country_name": "United Kingdom",
        "elevation": 83,
        "iata_code": "LHR",
        "icao_code": "EGLL",
        "latitude": 51.4706,
        "longitude": -0.461941,
        "municipality": "London",
        "name": "London Heathrow Airport",
    },
    "destination": {
        "country_iso_name": "QA",
        "country_name": "Qatar",
        "elevation": 13,
        "iata_code": "DOH",
        "icao_code": "OTHH",
        "latitude": 25.273056,
        "longitude": 51.608056,
        "municipality": "Doha",
        "name": "Hamad International Airport",
    },
}


def test_aircraft_only(client, mock_get):
    mock_get.return_value = make_response(json_data={"response": {"aircraft": AIRCRAFT}})
    resp = client.get("/api/adsbdb/A835AF")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["aircraft"]["registration"] == "N628TS"
    assert data["flightroute"] is None
    # No callsign query param -> combined endpoint's ?callsign= must not be sent
    _, kwargs = mock_get.call_args
    assert kwargs.get("params") is None


def test_combined_aircraft_and_callsign(client, mock_get):
    mock_get.return_value = make_response(
        json_data={"response": {"aircraft": AIRCRAFT, "flightroute": FLIGHTROUTE}}
    )
    resp = client.get("/api/adsbdb/A835AF?callsign=BAW123")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["aircraft"]["registration"] == "N628TS"
    assert data["flightroute"]["airline"]["name"] == "British Airways"
    assert data["flightroute"]["origin"]["iata_code"] == "LHR"
    _, kwargs = mock_get.call_args
    assert kwargs["params"] == {"callsign": "BAW123"}


def test_unknown_aircraft_404(client, mock_get):
    mock_get.return_value = make_response(status_code=404, json_data={"response": "unknown aircraft"})
    resp = client.get("/api/adsbdb/FFFFFF")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["aircraft"] is None
    assert data["flightroute"] is None


def test_known_aircraft_unknown_callsign_returns_aircraft_only(client, mock_get):
    # Per adsbdb's own docs: an unknown callsign query param on a known
    # aircraft still returns 200 with just the aircraft object.
    mock_get.return_value = make_response(json_data={"response": {"aircraft": AIRCRAFT}})
    resp = client.get("/api/adsbdb/A835AF?callsign=ZZZ99999")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["aircraft"]["registration"] == "N628TS"
    assert data["flightroute"] is None


def test_cache_never_expires(client, mock_get):
    mock_get.return_value = make_response(json_data={"response": {"aircraft": AIRCRAFT}})
    client.get("/api/adsbdb/A835AF")
    resp2 = client.get("/api/adsbdb/A835AF")
    assert mock_get.call_count == 1
    assert resp2.get_json()["aircraft"]["registration"] == "N628TS"


def test_cache_keyed_by_callsign_too(client, mock_get):
    # Same icao24, different callsign query -> distinct cache entry, distinct
    # upstream request (a given aircraft can fly different routes/callsigns).
    mock_get.return_value = make_response(json_data={"response": {"aircraft": AIRCRAFT}})
    client.get("/api/adsbdb/A835AF")
    client.get("/api/adsbdb/A835AF?callsign=BAW123")
    assert mock_get.call_count == 2


def test_unknown_aircraft_result_is_cached(client, mock_get):
    mock_get.return_value = make_response(status_code=404, json_data={"response": "unknown aircraft"})
    client.get("/api/adsbdb/FFFFFF")
    client.get("/api/adsbdb/FFFFFF")
    assert mock_get.call_count == 1


def test_network_error_returns_502_and_is_not_cached(client, mock_get):
    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/adsbdb/A835AF")
    assert resp.status_code == 502
    assert resp.get_json()["aircraft"] is None
    assert "A835AF:" not in app._adsbdb_cache
