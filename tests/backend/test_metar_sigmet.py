import requests

import app
from conftest import make_response

METAR_SAMPLE = [
    {"icaoId": "LWSK", "rawOb": "METAR LWSK 181320Z 24004KT 9999 FEW055 38/17 Q1009 NOSIG",
     "lat": 41.952, "lon": 21.627, "wdir": 240, "wspd": 4, "visib": "6+", "fltCat": "VFR"},
]

# One SIGMET whose polygon overlaps the test app's BBOX area (roughly
# Serbia, see app.AREA_CENTER), one whose polygon is nowhere near it.
NEARBY_SIGMET = {
    "icaoId": "LYBA", "hazard": "TURB", "qualifier": "SEV", "firName": "BEOGRAD",
    "coords": [{"lat": 44.0, "lon": 21.0}, {"lat": 45.0, "lon": 22.0}],
}
FAR_SIGMET = {
    "icaoId": "FAOR", "hazard": "ICE", "qualifier": "SEV", "firName": "JOHANNESBURG",
    "coords": [{"lat": -40.5, "lon": 54.6}, {"lat": -41.1, "lon": 57.0}],
}
# geom="AREAS" (multi-polygon) SIGMETs nest coords as a list of rings, each
# itself a list of point dicts — unlike geom="AREA"'s flat list (see
# NEARBY_SIGMET above). Modeled on a real FCBB/Brazzaville SIGMET that 500'd
# the first version of _sigmet_intersects_area, which assumed the flat shape
# unconditionally.
NEARBY_MULTI_POLYGON_SIGMET = {
    "icaoId": "LYBA", "hazard": "TS", "qualifier": "EMBD", "firName": "BEOGRAD", "geom": "AREAS",
    "coords": [
        [{"lat": 43.0, "lon": 20.0}, {"lat": 43.0, "lon": 21.0}, {"lat": 44.0, "lon": 21.0}],
        [{"lat": -50.0, "lon": 100.0}, {"lat": -51.0, "lon": 101.0}, {"lat": -50.0, "lon": 101.0}],
    ],
}


def test_metar_proxies_with_bbox(client, mock_get):
    mock_get.return_value = make_response(json_data=METAR_SAMPLE)
    resp = client.get("/api/metar")
    assert resp.status_code == 200
    assert resp.get_json() == METAR_SAMPLE

    _, kwargs = mock_get.call_args
    assert kwargs["params"]["bbox"] == "41.5,17.0,46.5,25.0"
    assert kwargs["params"]["format"] == "json"


def test_metar_is_cached(client, mock_get):
    mock_get.return_value = make_response(json_data=METAR_SAMPLE)
    client.get("/api/metar")
    client.get("/api/metar")
    assert mock_get.call_count == 1


def test_metar_network_error_serves_stale_cache(client, mock_get):
    mock_get.return_value = make_response(json_data=METAR_SAMPLE)
    client.get("/api/metar")

    app._metar_cache["ts"] = 0.0  # force the cache to be considered stale
    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/metar")
    assert resp.status_code == 200
    assert resp.get_json() == METAR_SAMPLE


def test_metar_network_error_no_cache_returns_502(client, mock_get):
    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/metar")
    assert resp.status_code == 502


def test_sigmet_filters_to_nearby_area_only(client, mock_get):
    mock_get.return_value = make_response(json_data=[NEARBY_SIGMET, FAR_SIGMET])
    resp = client.get("/api/sigmet")
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data) == 1
    assert data[0]["icaoId"] == "LYBA"


def test_sigmet_handles_multi_polygon_geom_areas(client, mock_get):
    mock_get.return_value = make_response(json_data=[NEARBY_MULTI_POLYGON_SIGMET, FAR_SIGMET])
    resp = client.get("/api/sigmet")
    assert resp.status_code == 200  # must not 500 on the nested-rings shape
    data = resp.get_json()
    assert len(data) == 1
    assert data[0]["icaoId"] == "LYBA"


def test_sigmet_is_cached(client, mock_get):
    mock_get.return_value = make_response(json_data=[NEARBY_SIGMET])
    client.get("/api/sigmet")
    client.get("/api/sigmet")
    assert mock_get.call_count == 1


def test_sigmet_network_error_no_cache_returns_502(client, mock_get):
    mock_get.side_effect = requests.ConnectionError("boom")
    resp = client.get("/api/sigmet")
    assert resp.status_code == 502
