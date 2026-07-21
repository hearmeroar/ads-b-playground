"""enrichment/airports.py's nearest_airport() — a pure lookup over a
vendored OpenFlights extract, same "no HTTP involved" category as
test_enrichment.py (no mock_get/mock_post fixture needed). Also covers
list_map_airports()/airports_in_bbox() (the OurAirports-backed map layer
dataset) and the /api/airports route, which does need the `client` fixture
since it's a real Flask route."""

from enrichment.airports import airports_in_bbox, list_map_airports, nearest_airport, search_airports


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
    resp = client.get("/api/airports", query_string={"bbox": "51.0,-1.0,52.0,0.0"})
    assert resp.status_code == 200
    icaos = [a["icao"] for a in resp.get_json()["airports"]]
    assert "EGLL" in icaos


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
    # neighborhood), which comfortably contains London Heathrow.
    resp = client.get("/api/airports")
    assert resp.status_code == 200
    icaos = [a["icao"] for a in resp.get_json()["airports"]]
    assert "EGLL" in icaos


def test_api_airports_malformed_bbox_falls_back_to_home_region(client):
    resp = client.get("/api/airports", query_string={"bbox": "not,a,valid,bbox"})
    assert resp.status_code == 200
    icaos = [a["icao"] for a in resp.get_json()["airports"]]
    assert "EGLL" in icaos


def test_api_airports_types_param_filters_result(client):
    resp = client.get(
        "/api/airports",
        query_string={"bbox": "51.0,-1.0,52.0,0.0", "types": "large_airport"},
    )
    assert resp.status_code == 200
    airports = resp.get_json()["airports"]
    assert airports  # London Heathrow itself should still be there
    assert all(a["type"] == "large_airport" for a in airports)


def test_api_airports_no_types_param_returns_every_type(client):
    # No `types` at all (the pre-existing caller shape) must stay unfiltered
    # — a request that never mentions the param behaves exactly as it did
    # before this filter was added.
    resp = client.get("/api/airports", query_string={"bbox": "51.0,-1.0,52.0,0.0"})
    assert resp.status_code == 200
    icaos = [a["icao"] for a in resp.get_json()["airports"]]
    assert "EGLL" in icaos


# --- search_airports() (backs the zone-switcher's search box) --------------

def test_search_airports_empty_or_short_query_returns_nothing():
    assert search_airports("") == []
    assert search_airports(None) == []
    assert search_airports("b") == []  # below the 2-char minimum


def test_search_airports_exact_code_match_ranks_first():
    results = search_airports("beg")
    assert results  # a real, stable worked example
    assert results[0]["icao"] == "LYBE"
    assert results[0]["iata"] == "BEG"


def test_search_airports_matches_by_name_city_and_country():
    by_name = search_airports("Nikola Tesla")
    assert any(a["icao"] == "LYBE" for a in by_name)
    by_city = search_airports("Belgrade")
    assert any(a["icao"] == "LYBE" for a in by_city)
    by_country = search_airports("Serbia")
    assert any(a["icao"] == "LYBE" for a in by_country)


def test_search_airports_is_case_insensitive():
    assert search_airports("BEG")[0]["icao"] == "LYBE"
    assert search_airports("beg")[0]["icao"] == "LYBE"
    assert search_airports("BeG")[0]["icao"] == "LYBE"


def test_search_airports_prefix_beats_substring():
    # "London" is a prefix of many airport/city names; a name-prefix match
    # must rank ahead of an airport that merely contains "london" deeper in
    # its name/municipality/country fields.
    results = search_airports("london heathrow")
    assert results
    assert results[0]["icao"] == "EGLL"


def test_search_airports_excludes_closed_airports():
    results = search_airports("Nikola Tesla")
    assert all(a["type"] != "closed" for a in results)


def test_search_airports_limit_is_respected_and_capped():
    assert len(search_airports("airport", limit=3)) <= 3
    # A caller-supplied limit above the server-side ceiling is clamped, not
    # honored outright — same defensive posture as /api/airports/search's
    # own clamp on the raw query-string value.
    assert len(search_airports("airport", limit=1000)) <= 50


def test_search_airports_result_shape_matches_map_layer():
    result = search_airports("beg")[0]
    for key in ("ident", "type", "name", "lat", "lon", "elevation_ft", "country", "municipality", "iata", "icao", "country_name"):
        assert key in result


# --- /api/airports/search route ---------------------------------------------

def test_api_airports_search_finds_worked_example(client):
    resp = client.get("/api/airports/search", query_string={"q": "beg"})
    assert resp.status_code == 200
    icaos = [a["icao"] for a in resp.get_json()["airports"]]
    assert "LYBE" in icaos


def test_api_airports_search_missing_query_returns_empty(client):
    resp = client.get("/api/airports/search")
    assert resp.status_code == 200
    assert resp.get_json()["airports"] == []


def test_api_airports_search_malformed_limit_falls_back_to_default(client):
    resp = client.get("/api/airports/search", query_string={"q": "beg", "limit": "not-a-number"})
    assert resp.status_code == 200
    assert "LYBE" in [a["icao"] for a in resp.get_json()["airports"]]


def test_api_airports_search_limit_clamped_server_side(client):
    resp = client.get("/api/airports/search", query_string={"q": "airport", "limit": "500"})
    assert resp.status_code == 200
    assert len(resp.get_json()["airports"]) <= 50
