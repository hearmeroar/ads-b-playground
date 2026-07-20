"""enrichment/airports.py's nearest_airport() — a pure lookup over a
vendored OpenFlights extract, same "no HTTP involved" category as
test_enrichment.py (no mock_get/mock_post fixture needed). Also covers
list_map_airports()/airports_in_bbox() (the OurAirports-backed map layer
dataset) and the /api/airports route, which does need the `client` fixture
since it's a real Flask route."""

from enrichment.airports import airports_in_bbox, list_map_airports, nearest_airport


def test_nearest_airport_finds_close_match():
    # Right over Belgrade Nikola Tesla Airport (BEG) — this app's own
    # AREA_CENTER neighborhood, a real stable OpenFlights entry.
    result = nearest_airport(44.8125, 20.4612)
    assert result["iata"] == "BEG"
    assert result["icao"] == "LYBE"
    assert result["city"] == "Belgrade"
    assert result["distance_km"] < 20


def test_nearest_airport_distance_grows_further_away():
    close = nearest_airport(44.8125, 20.4612)
    far = nearest_airport(45.5, 21.5)  # well off the airport, same region
    assert far["distance_km"] > close["distance_km"]


def test_nearest_airport_none_without_coordinates():
    assert nearest_airport(None, None) is None
    assert nearest_airport(None, 20.4612) is None
    assert nearest_airport(44.8125, None) is None


def test_nearest_airport_none_for_invalid_coordinates():
    assert nearest_airport("not-a-number", 20.4612) is None


# --- Map-layer dataset (list_map_airports / airports_in_bbox) --------------
# OurAirports-backed, not the OpenFlights table nearest_airport() above uses
# — a separate dataset with a `type` field (large_airport/heliport/closed/...)
# the OpenFlights one doesn't have. Belgrade Nikola Tesla (BEG/LYBE) is a
# real, stable entry in both tables, so it's reused here as the worked
# example the same way it is above.

def test_list_map_airports_includes_worked_example():
    airports = list_map_airports()
    beg = next((a for a in airports if a["icao"] == "LYBE"), None)
    assert beg is not None
    assert beg["iata"] == "BEG"
    assert beg["type"] == "large_airport"
    assert beg["country"] == "RS"
    assert beg["country_name"] == "Serbia"
    assert beg["municipality"] == "Belgrade"


def test_list_map_airports_excludes_closed_by_default():
    airports = list_map_airports()
    assert not any(a["type"] == "closed" for a in airports)
    # The dataset does contain closed airports — include_closed=True proves
    # the exclusion above is this function filtering them, not an absence
    # in the underlying data.
    assert any(a["type"] == "closed" for a in list_map_airports(include_closed=True))


def test_airports_in_bbox_filters_by_bounds():
    # A tight box around Belgrade finds BEG...
    nearby = airports_in_bbox(44.5, 20.0, 45.1, 20.6)
    assert any(a["icao"] == "LYBE" for a in nearby)
    # ...but a box on the other side of the world does not.
    far = airports_in_bbox(-45.0, 170.0, -44.0, 171.0)
    assert not any(a["icao"] == "LYBE" for a in far)


def test_airports_in_bbox_invalid_bounds_return_empty():
    assert airports_in_bbox("not-a-number", 20.0, 45.1, 20.6) == []
    assert airports_in_bbox(45.1, 20.0, 44.5, 20.6) == []  # lamin > lamax


# --- /api/airports route ---------------------------------------------------

def test_api_airports_with_bbox(client):
    resp = client.get("/api/airports", query_string={"bbox": "44.5,20.0,45.1,20.6"})
    assert resp.status_code == 200
    icaos = [a["icao"] for a in resp.get_json()["airports"]]
    assert "LYBE" in icaos


def test_api_airports_without_bbox_falls_back_to_home_region(client):
    # No bbox param — falls back to this app's own BBOX (AREA_CENTER's
    # neighborhood), which comfortably contains Belgrade.
    resp = client.get("/api/airports")
    assert resp.status_code == 200
    icaos = [a["icao"] for a in resp.get_json()["airports"]]
    assert "LYBE" in icaos


def test_api_airports_malformed_bbox_falls_back_to_home_region(client):
    resp = client.get("/api/airports", query_string={"bbox": "not,a,valid,bbox"})
    assert resp.status_code == 200
    icaos = [a["icao"] for a in resp.get_json()["airports"]]
    assert "LYBE" in icaos
