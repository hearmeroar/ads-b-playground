"""enrichment/airports.py's nearest_airport() — a pure lookup over a
vendored OpenFlights extract, same "no HTTP involved" category as
test_enrichment.py (no mock_get/mock_post, no client fixture needed)."""

from enrichment.airports import nearest_airport


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
