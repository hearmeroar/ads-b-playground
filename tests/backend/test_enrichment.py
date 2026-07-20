"""Covers both the enrichment/ package's pure lookup functions (no HTTP
involved at all, so no mock_get/mock_post needed) and the /api/identity/
<icao24> route, which is a thin, literal pass-through of the orchestrator.
Kept in one file since the route shares the exact same vocabulary/fixtures
(e.g. the "49d3d3" record) as the unit tests — splitting would duplicate
those constants for no isolation benefit.

Note: conftest.py's reset_caches fixture needs no new entry for this route.
Every other route's cache exists to protect a rate-limited *external* HTTP
call; this route makes none — it's pure, sub-millisecond dict lookups over a
few dozen entries, so there's nothing here to cache or reset.
"""

from enrichment.aircraft_database import normalize_aircraft_type
from enrichment.aircraft_enrichment import enrich_identity
from enrichment.callsign import decode_callsign
from enrichment.registration import lookup_country_by_registration


# --- registration.py ---

def test_registration_prefix_examples():
    assert lookup_country_by_registration("OK-SWC")["country_iso"] == "CZ"
    assert lookup_country_by_registration("N123AB")["country_iso"] == "US"
    assert lookup_country_by_registration("G-ABCD")["country_iso"] == "GB"
    assert lookup_country_by_registration("D-ABCD")["country_iso"] == "DE"
    assert lookup_country_by_registration("YU-ABC")["country_iso"] == "RS"


def test_registration_prefix_result_shape():
    result = lookup_country_by_registration("OK-SWC")
    assert result["country"] == "Czech Republic"
    assert result["country_iso"] == "CZ"
    assert result["source"] == "registration_prefix"
    assert result["confidence"] == 1.0


def test_registration_prefix_unknown_returns_none():
    assert lookup_country_by_registration("ZZ-999") is None
    assert lookup_country_by_registration(None) is None
    assert lookup_country_by_registration("") is None


def test_registration_prefix_covers_essentially_every_icao_member_state():
    # The table was expanded from a ~20-entry placeholder to essentially the
    # full ICAO/ITU nationality-mark list (192 entries) — spot-check a few
    # that were NOT in the original placeholder set, across regions.
    assert lookup_country_by_registration("SE-RTJ")["country_iso"] == "SE"  # Sweden
    assert lookup_country_by_registration("JA123A")["country_iso"] == "JP"  # Japan
    assert lookup_country_by_registration("VH-ABC")["country_iso"] == "AU"  # Australia
    assert lookup_country_by_registration("ZS-ABC")["country_iso"] == "ZA"  # South Africa
    assert lookup_country_by_registration("PP-ABC")["country_iso"] == "BR"  # Brazil


def test_registration_prefix_israel():
    # Found missing the same way SE (Sweden) was originally: a real aircraft
    # (4X-ABS, Israir) resolved no country at all because "4X" wasn't in the
    # table yet.
    result = lookup_country_by_registration("4X-ABS")
    assert result["country_iso"] == "IL"
    assert result["country"] == "Israel"


def test_registration_prefix_composite_marks_hong_kong_macau():
    # Hong Kong ("B-H...") and Macau ("B-M...") both fall under China's bare
    # "B" mark but get their own sub-block after the dash — the more specific
    # "B"+first-char-after-dash candidate must win over the bare "B" (China).
    assert lookup_country_by_registration("B-HAA")["country_iso"] == "HK"
    assert lookup_country_by_registration("B-MAA")["country_iso"] == "MO"
    assert lookup_country_by_registration("B-1234")["country_iso"] == "CN"


# --- aircraft_database.py: ICAO24 lookup ---

def test_icao24_lookup_matches_user_example():
    from enrichment.aircraft_database import DEFAULT_AIRCRAFT_DATABASE
    record = DEFAULT_AIRCRAFT_DATABASE.lookup("49d3d3")
    assert record["registration"] == "OK-SWC"
    assert record["operator"] == "Smartwings"
    assert record["country"] == "Czech Republic"
    assert record["manufacturer"] == "Boeing"
    assert record["model"] == "737 MAX 8"
    assert record["year_built"] == 2021
    assert record["source"] == "icao24_lookup"
    assert record["confidence"] == 1.0


def test_icao24_lookup_case_insensitive():
    from enrichment.aircraft_database import DEFAULT_AIRCRAFT_DATABASE
    assert DEFAULT_AIRCRAFT_DATABASE.lookup("49D3D3")["registration"] == "OK-SWC"


def test_icao24_lookup_unknown_hex_returns_none():
    from enrichment.aircraft_database import DEFAULT_AIRCRAFT_DATABASE
    assert DEFAULT_AIRCRAFT_DATABASE.lookup("ffffff") is None
    assert DEFAULT_AIRCRAFT_DATABASE.lookup(None) is None


# --- callsign.py ---

def test_decode_callsign_example():
    result = decode_callsign("TVP7200")
    assert result["operator"] == "Smartwings"
    assert result["source"] == "callsign_decode"
    assert result["confidence"] == 0.8


def test_decode_callsign_also_yields_country():
    result = decode_callsign("TVP7200")
    assert result["country"] == "Czech Republic"
    assert result["country_confidence"] == 0.6


def test_decode_callsign_lowercase_and_unknown():
    assert decode_callsign("ryr123")["operator"] == "Ryanair"
    # "ZZZ" used to be a safe "definitely not a real designator" placeholder
    # for a 96-entry hand-curated table, but collides with a real one
    # (Zabaykalskii Airlines, Russia) now that AIRLINE_OPERATORS includes
    # OpenFlights' ~5700-entry data/airlines.dat — "XQZ" is checked against
    # the live table below rather than assumed, so this doesn't rot again.
    from enrichment.callsign import AIRLINE_OPERATORS
    assert "XQZ" not in AIRLINE_OPERATORS
    assert decode_callsign("XQZ999") is None
    assert decode_callsign(None) is None


def test_decode_callsign_covers_at_least_90_airlines():
    # The hand-curated tier alone was expanded from 18 to ~90+ entries; this
    # documents that minimum and guards against accidental regressions there.
    # The merged AIRLINE_OPERATORS (curated + OpenFlights-generated, see
    # callsign.py's module docstring) is far larger — see
    # test_decode_callsign_generated_tier_adds_broad_coverage below.
    from enrichment.callsign import _CURATED_AIRLINE_OPERATORS
    assert len(_CURATED_AIRLINE_OPERATORS) >= 90


def test_decode_callsign_generated_tier_adds_broad_coverage():
    # The OpenFlights-derived tier should dwarf the hand-curated one —
    # documents the minimum expected size and guards against the generation
    # step silently regressing (e.g. an over-aggressive country-name filter).
    from enrichment.callsign import AIRLINE_OPERATORS, _GENERATED_AIRLINE_OPERATORS
    assert len(_GENERATED_AIRLINE_OPERATORS) >= 5000
    assert len(AIRLINE_OPERATORS) >= 5000


def test_decode_callsign_curated_tier_wins_over_generated():
    # OpenFlights' own data is stale enough to disagree with (or lack
    # entirely) some current airlines — the hand-curated tier must always
    # win. "QFA" is the confirmed real-world case: OpenFlights has it as
    # plain "Qantas", not "Qantas Airways".
    from enrichment.callsign import _CURATED_AIRLINE_OPERATORS, _GENERATED_AIRLINE_OPERATORS
    assert _GENERATED_AIRLINE_OPERATORS["QFA"]["operator"] == "Qantas"
    assert _CURATED_AIRLINE_OPERATORS["QFA"]["operator"] == "Qantas Airways"
    assert decode_callsign("QFA123")["operator"] == "Qantas Airways"


def test_decode_callsign_rys_resolves_to_buzz_not_royal_sky():
    # Found via a real aircraft (SP-RKZ, callsign RYS7025): "RYS" is Buzz's
    # real ICAO designator (Ryanair Group's Polish subsidiary, formerly
    # "Ryanair Sun" — hence the code), but OpenFlights' own data has an
    # unrelated Thai airline, "Royal Sky", under the same code — which was
    # winning by default until "RYS" was added to the curated tier.
    from enrichment.callsign import _GENERATED_AIRLINE_OPERATORS
    assert _GENERATED_AIRLINE_OPERATORS["RYS"]["operator"] == "Royal Sky"
    result = decode_callsign("RYS7025")
    assert result["operator"] == "Buzz"
    assert result["country_iso"] == "PL"


def test_decode_callsign_generated_tier_resolves_an_airline_curated_lacks():
    # A spot-check that the generated tier is actually reachable end-to-end
    # through decode_callsign(), not just present in the raw dict — "KAP"
    # (Cape Air) is real but was never in the hand-curated 96.
    from enrichment.callsign import _CURATED_AIRLINE_OPERATORS
    assert "KAP" not in _CURATED_AIRLINE_OPERATORS
    result = decode_callsign("KAP123")
    assert result is not None
    assert result["operator"] == "Cape Air"
    assert result["source"] == "callsign_decode"


def test_decode_callsign_every_entry_has_a_valid_country():
    # Every ISO code in AIRLINE_OPERATORS must be present in countries.py,
    # otherwise the country field would silently be missing from the result.
    from enrichment.callsign import AIRLINE_OPERATORS
    from enrichment.countries import COUNTRIES_BY_ISO
    for code, entry in AIRLINE_OPERATORS.items():
        assert entry["country_iso"] in COUNTRIES_BY_ISO, (
            f"AIRLINE_OPERATORS['{code}'] has unknown ISO '{entry['country_iso']}'"
        )


def test_decode_callsign_covers_all_regions():
    # Spot-check at least one airline from each major region.
    regions = {
        "ASL": ("Air Serbia", "RS"),    # Balkans
        "AAL": ("American Airlines", "US"),  # North America
        "WJA": ("WestJet", "CA"),        # Canada
        "QTR": ("Qatar Airways", "QA"),  # Middle East
        "SIA": ("Singapore Airlines", "SG"),  # Asia
        "QFA": ("Qantas Airways", "AU"),  # Oceania
        "ETH": ("Ethiopian Airlines", "ET"),  # Africa
        "ITY": ("ITA Airways", "IT"),    # Europe
    }
    for code, (expected_operator, expected_iso) in regions.items():
        result = decode_callsign(code + "123")
        assert result is not None, f"Failed to decode {code}"
        assert result["operator"] == expected_operator, f"{code}: expected {expected_operator}, got {result['operator']}"
        assert result["country_iso"] == expected_iso, f"{code}: expected {expected_iso}, got {result['country_iso']}"


# --- aircraft_database.py: type normalization ---

def test_normalize_aircraft_type_by_code():
    assert normalize_aircraft_type("B38M") == {
        "manufacturer": "Boeing", "model": "737 MAX 8",
        "icao_type": "B38M", "source": "aircraft_type_db", "confidence": 1.0,
    }
    result = normalize_aircraft_type("A20N")
    assert result["manufacturer"] == "Airbus"
    assert result["model"] == "A320neo"


def test_normalize_aircraft_type_by_free_text_case_insensitive():
    result = normalize_aircraft_type("b737 max 8")
    assert result["manufacturer"] == "Boeing"
    assert result["model"] == "737 MAX 8"
    assert result["icao_type"] is None  # matched via free text, not a code


def test_normalize_aircraft_type_unknown_returns_none():
    assert normalize_aircraft_type("NOTREAL") is None
    assert normalize_aircraft_type(None) is None


# --- aircraft_enrichment.py: orchestrator priority chains ---

def test_enrich_identity_country_live_wins():
    result = enrich_identity("49d3d3", registration="OK-SWC", known_country="Elsewhere")
    assert result["country"]["value"] == "Elsewhere"
    assert result["country"]["source"] == "live"


def test_enrich_identity_country_live_still_gets_a_flag_when_name_matches():
    # A flag can attach to a live-sourced country without changing its
    # source/confidence — a presentation add-on, not enrichment.
    result = enrich_identity("ffffff", known_country="Czech Republic")
    assert result["country"]["value"] == "Czech Republic"
    assert result["country"]["source"] == "live"
    assert result["country"]["country_iso"] == "CZ"


def test_enrich_identity_country_live_unrecognized_name_has_no_iso():
    result = enrich_identity("ffffff", known_country="Not A Real Country")
    assert result["country"]["value"] == "Not A Real Country"
    assert result["country"]["source"] == "live"
    assert "country_iso" not in result["country"]


def test_enrich_identity_country_registration_prefix_tier():
    result = enrich_identity("ffffff", registration="OK-SWC")
    assert result["country"]["value"] == "Czech Republic"
    assert result["country"]["source"] == "registration_prefix"


def test_enrich_identity_country_icao24_tier():
    result = enrich_identity("49d3d3")
    assert result["country"]["value"] == "Czech Republic"
    assert result["country"]["source"] == "icao24_lookup"


def test_enrich_identity_country_has_no_callsign_tier():
    # Country means country of *registration* — a callsign only reveals the
    # operator's home country, which is a different concept (surfaced via
    # the operator tier's own country_iso instead, see below), so it must
    # never fill "country" even when nothing else resolves it.
    result = enrich_identity("ffffff", callsign="TVP7200")
    assert result["country"] is None


def test_enrich_identity_country_unknown():
    assert enrich_identity("ffffff")["country"] is None


def test_enrich_identity_operator_live_wins():
    result = enrich_identity("49d3d3", known_operator="Some Other Airline")
    assert result["operator"]["value"] == "Some Other Airline"
    assert result["operator"]["source"] == "live"


def test_enrich_identity_operator_icao24_tier():
    result = enrich_identity("49d3d3")
    assert result["operator"]["value"] == "Smartwings"
    assert result["operator"]["source"] == "icao24_lookup"


def test_enrich_identity_operator_callsign_tier():
    result = enrich_identity("ffffff", callsign="RYR123")
    assert result["operator"]["value"] == "Ryanair"
    assert result["operator"]["source"] == "callsign_decode"


def test_enrich_identity_operator_country_callsign_tier():
    # The callsign->operator lookup's country data (the airline's home
    # country) surfaces as its own "operator_country" field — never in the
    # unrelated "country" field (registration), and never smuggled onto
    # "operator" itself either.
    result = enrich_identity("ffffff", callsign="RYR123")
    assert result["operator_country"]["value"] == "Ireland"
    assert result["operator_country"]["country_iso"] == "IE"
    assert result["operator_country"]["source"] == "callsign_decode"
    assert "country_iso" not in result["operator"]


def test_enrich_identity_operator_country_unknown():
    assert enrich_identity("ffffff")["operator_country"] is None


def test_enrich_identity_operator_country_no_tier_from_icao24_lookup():
    # aircraft_database.py's placeholder records only carry one country_iso
    # (the aircraft's own registration country, already used for "country")
    # — it must not double as operator_country too.
    result = enrich_identity("49d3d3")
    assert result["operator"]["value"] == "Smartwings"
    assert result["operator_country"] is None


def test_enrich_identity_operator_unknown():
    assert enrich_identity("ffffff")["operator"] is None


def test_enrich_identity_registration_live_wins():
    result = enrich_identity("49d3d3", registration="X-DECOY")
    assert result["registration"]["value"] == "X-DECOY"
    assert result["registration"]["source"] == "live"


def test_enrich_identity_registration_icao24_tier():
    result = enrich_identity("49d3d3")
    assert result["registration"]["value"] == "OK-SWC"
    assert result["registration"]["source"] == "icao24_lookup"


def test_enrich_identity_registration_unknown():
    assert enrich_identity("ffffff")["registration"] is None


def test_enrich_identity_manufacturer_model_icao24_tier():
    result = enrich_identity("49d3d3")
    assert result["manufacturer"]["value"] == "Boeing"
    assert result["model"]["value"] == "737 MAX 8"
    assert result["manufacturer"]["source"] == "icao24_lookup"


def test_enrich_identity_manufacturer_model_aircraft_type_tier():
    result = enrich_identity("ffffff", aircraft_type="B38M")
    assert result["manufacturer"]["value"] == "Boeing"
    assert result["model"]["value"] == "737 MAX 8"
    assert result["manufacturer"]["source"] == "aircraft_type_db"


def test_enrich_identity_manufacturer_model_unknown():
    result = enrich_identity("ffffff")
    assert result["manufacturer"] is None
    assert result["model"] is None


def test_enrich_identity_year_built_live_wins():
    result = enrich_identity("49d3d3", known_manufacture_year=1999)
    assert result["year_built"]["value"] == 1999
    assert result["year_built"]["source"] == "live"


def test_enrich_identity_year_built_icao24_tier():
    result = enrich_identity("49d3d3")
    assert result["year_built"]["value"] == 2021
    assert result["year_built"]["source"] == "icao24_lookup"


def test_enrich_identity_year_built_unknown():
    assert enrich_identity("ffffff")["year_built"] is None


def test_enrich_identity_all_fields_unknown_when_nothing_resolves():
    result = enrich_identity("ffffff")
    assert all(result[key] is None for key in
               ("country", "operator", "operator_country", "registration", "manufacturer", "model", "year_built"))


# --- /api/identity/<icao24> route ---

def test_route_full_known_aircraft(client):
    resp = client.get("/api/identity/49d3d3")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["country"]["value"] == "Czech Republic"
    assert data["operator"]["value"] == "Smartwings"
    assert data["registration"]["value"] == "OK-SWC"
    assert data["manufacturer"]["value"] == "Boeing"
    assert data["model"]["value"] == "737 MAX 8"
    assert data["year_built"]["value"] == 2021


def test_route_uppercase_icao24_same_result(client):
    resp = client.get("/api/identity/49D3D3")
    assert resp.get_json()["registration"]["value"] == "OK-SWC"


def test_route_unresolvable_aircraft_all_none(client):
    resp = client.get("/api/identity/ffffff")
    data = resp.get_json()
    assert all(data[key] is None for key in
               ("country", "operator", "registration", "manufacturer", "model", "year_built"))


def test_route_known_country_short_circuits(client):
    resp = client.get("/api/identity/49d3d3?known_country=Somewhere+Else")
    data = resp.get_json()
    assert data["country"]["value"] == "Somewhere Else"
    assert data["country"]["source"] == "live"


def test_route_query_params_feed_the_fallback_tiers(client):
    resp = client.get("/api/identity/ffffff?registration=OK-SWC&callsign=TVP7200&aircraft_type=B38M")
    data = resp.get_json()
    assert data["country"]["source"] == "registration_prefix"  # outranks callsign_decode
    assert data["operator"]["value"] == "Smartwings"  # from callsign_decode, no icao24 record here
    assert data["manufacturer"]["value"] == "Boeing"  # from aircraft_type_db, no icao24 record here
