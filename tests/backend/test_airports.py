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


def test_airports_in_bbox_radius_filter_narrows_bbox_result():
    # A wide bbox spanning Belgrade and well beyond finds BEG with no
    # radius filter applied...
    wide = airports_in_bbox(30.0, 0.0, 60.0, 40.0)
    assert any(a["icao"] == "LYBE" for a in wide)
    # ...but centering a tight radius far from Belgrade (while the bbox
    # itself still contains it) drops it — the radius filter is
    # independent of, and narrower than, the bbox check.
    far_center = airports_in_bbox(30.0, 0.0, 60.0, 40.0, center=(35.0, -5.0), radius_km=200)
    assert not any(a["icao"] == "LYBE" for a in far_center)
    # A radius that does cover Belgrade keeps it.
    near_center = airports_in_bbox(30.0, 0.0, 60.0, 40.0, center=(44.0, 21.0), radius_km=407)
    assert any(a["icao"] == "LYBE" for a in near_center)


# --- Per-size `types` filter (backs the frontend's airport-type checklist) --

def test_list_map_airports_types_filter_restricts_to_given_types():
    airports = list_map_airports(types=["large_airport"])
    assert airports  # the real dataset has plenty of large airports
    assert all(a["type"] == "large_airport" for a in airports)


def test_list_map_airports_types_filter_none_means_unfiltered():
    # None (the default) must behave exactly like before this filter
    # existed — every non-closed type present, not just some default subset.
    unfiltered = list_map_airports()
    assert any(a["type"] == "heliport" for a in unfiltered)
    assert any(a["type"] == "small_airport" for a in unfiltered)


def test_airports_in_bbox_types_filter():
    # Belgrade Nikola Tesla (large_airport) is in view either way; asking
    # only for heliports/small airports must drop it, while asking for its
    # own type keeps it.
    without_large = airports_in_bbox(44.5, 20.0, 45.1, 20.6, types=["heliport", "small_airport"])
    assert not any(a["icao"] == "LYBE" for a in without_large)
    with_large = airports_in_bbox(44.5, 20.0, 45.1, 20.6, types=["large_airport"])
    assert any(a["icao"] == "LYBE" for a in with_large)


# --- /api/airports route ---------------------------------------------------

def test_api_airports_with_bbox(client):
    resp = client.get("/api/airports", query_string={"bbox": "44.5,20.0,45.1,20.6"})
    assert resp.status_code == 200
    icaos = [a["icao"] for a in resp.get_json()["airports"]]
    assert "LYBE" in icaos


def test_api_airports_scoped_to_scan_zone(client):
    # A bbox around Tokyo is valid and would normally return real airports,
    # but it's nowhere near this app's own scan zone (AREA_CENTER/
    # AREA_RADIUS_KM, the Balkans) — the route must scope to that zone
    # regardless of what the viewport itself is showing.
    resp = client.get("/api/airports", query_string={"bbox": "35.5,139.6,35.8,139.9"})
    assert resp.status_code == 200
    assert resp.get_json()["airports"] == []


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


def test_api_airports_types_param_filters_result(client):
    resp = client.get(
        "/api/airports",
        query_string={"bbox": "44.5,20.0,45.1,20.6", "types": "large_airport"},
    )
    assert resp.status_code == 200
    airports = resp.get_json()["airports"]
    assert airports  # Belgrade Nikola Tesla itself should still be there
    assert all(a["type"] == "large_airport" for a in airports)


def test_api_airports_no_types_param_returns_every_type(client):
    # No `types` at all (the pre-existing caller shape) must stay unfiltered
    # — a request that never mentions the param behaves exactly as it did
    # before this filter was added.
    resp = client.get("/api/airports", query_string={"bbox": "44.5,20.0,45.1,20.6"})
    assert resp.status_code == 200
    icaos = [a["icao"] for a in resp.get_json()["airports"]]
    assert "LYBE" in icaos
