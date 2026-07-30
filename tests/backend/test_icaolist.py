"""Covers enrichment/icaolist.py's own pure lookup functions (no HTTP, same
"no mock_get/mock_post needed" category as test_enrichment.py) and its
integration into aircraft_enrichment.py's enrich_identity() as a bottom-tier
fallback below every existing local-lookup table.

conftest.py's reset_caches needs no new entry here — icaolist.py loads its
4 vendored JSON files once at import into module-level constants, never
mutated at runtime, same as registration.py/icao24_allocation.py/callsign.py.
"""

from enrichment import icaolist
from enrichment.aircraft_enrichment import enrich_identity
from enrichment.callsign import AIRLINE_OPERATORS
from enrichment.icao24_allocation import country_for_icao24
from enrichment.registration import PREFIX_TO_ISO


# --- icaolist.py: lookup_type() ---

def test_lookup_type_covers_a_type_the_curated_table_does_not():
    # An-124 Ruslan has no entry in aircraft_database.py's own hand-curated
    # TYPE_CODE_TABLE (~150 common airliner/GA types) -- this is exactly
    # the kind of gap this dataset's ~2765 entries exist to fill.
    result = icaolist.lookup_type("A124")
    assert result["manufacturer"] == "Antonov"
    assert result["model"] == "An-124 Ruslan"
    assert result["source"] == "icaolist"
    assert 0 < result["confidence"] < 1.0  # below aircraft_type_db's 1.0


def test_lookup_type_unknown_returns_none():
    assert icaolist.lookup_type("QQQQ") is None
    assert icaolist.lookup_type(None) is None
    assert icaolist.lookup_type("") is None


def test_lookup_type_excludes_icaos_placeholder_designator():
    # "ZZZZ" is ICAO's own official "type not (yet) assigned a designator"
    # code -- a real row in the source CSV, but not a real aircraft type;
    # see the generation script's own filter for why it's excluded.
    assert icaolist.lookup_type("ZZZZ") is None


def test_lookup_type_case_insensitive():
    assert icaolist.lookup_type("a124") == icaolist.lookup_type("A124")


def test_types_table_size_guard():
    assert len(icaolist._TYPES) >= 2000


# --- icaolist.py: country_for_registration_prefix() ---

def test_registration_prefix_covers_a_prefix_the_curated_table_does_not():
    # Monaco's "3A" mark isn't in registration.py's own PREFIX_TO_ISO.
    assert "3A" not in PREFIX_TO_ISO
    result = icaolist.country_for_registration_prefix("3A-ABC")
    assert result["country"] == "Monaco"
    assert result["country_iso"] == "MC"
    assert result["source"] == "icaolist"
    assert 0 < result["confidence"] < 1.0


def test_registration_prefix_unknown_returns_none():
    # Dash-delimited form only ever tries the 3-char composite and 2-char
    # prefix candidates (never falls back to a bare 1-char candidate,
    # same as registration.py's own algorithm this mirrors) -- "ZZ" isn't
    # a real prefix in this dataset, so this is a genuine miss, unlike a
    # bare "ZZ9999" which would fall back to "Z" (a real Zimbabwe mark).
    assert icaolist.country_for_registration_prefix("ZZ-999") is None
    assert icaolist.country_for_registration_prefix(None) is None


def test_reg_prefixes_table_size_guard():
    assert len(icaolist._REG_PREFIXES) >= 150


# --- icaolist.py: country_for_icao24_hex() ---

def test_hex_range_covers_a_block_the_curated_table_does_not():
    # Taiwan has no block in icao24_allocation.py's own ICAO24_BLOCKS
    # (Taiwan is not an ICAO member state) but does have one in ICAOList.
    assert country_for_icao24("899100") is None
    result = icaolist.country_for_icao24_hex("899100")
    assert result["country"] == "Taiwan"
    assert result["country_iso"] == "TW"
    assert result["source"] == "icaolist"
    assert 0 < result["confidence"] < 1.0


def test_hex_range_unallocated_or_invalid_returns_none():
    assert icaolist.country_for_icao24_hex("FFFFFF") is None
    assert icaolist.country_for_icao24_hex(None) is None
    assert icaolist.country_for_icao24_hex("not-hex") is None


def test_hex_ranges_table_size_guard():
    assert len(icaolist._HEX_RANGES) >= 100


# --- icaolist.py: lookup_airline() ---

def test_lookup_airline_covers_a_code_not_in_callsign_py():
    # Generated with every code already in callsign.py's own
    # AIRLINE_OPERATORS excluded (see icaolist.py's module docstring) --
    # this table only ever holds genuinely new codes.
    assert "AAE" not in AIRLINE_OPERATORS
    result = icaolist.lookup_airline("AAE123")
    assert result["operator"] == "Air Atlanta Europe"
    assert result["country"] == "Malta"
    assert result["country_iso"] == "MT"
    assert result["source"] == "icaolist"
    assert 0 < result["confidence"] < 1.0


def test_lookup_airline_unknown_returns_none():
    assert icaolist.lookup_airline("ZZZ999") is None
    assert icaolist.lookup_airline(None) is None


def test_airlines_table_size_guard():
    assert len(icaolist._AIRLINES) >= 1000


# --- aircraft_enrichment.py: orchestrator integration ---

def test_enrich_identity_manufacturer_model_icaolist_fallback_tier():
    result = enrich_identity("abcdef", icao_type_code="A124")
    assert result["manufacturer"]["value"] == "Antonov"
    assert result["model"]["value"] == "An-124 Ruslan"
    assert result["manufacturer"]["source"] == "icaolist"


def test_enrich_identity_manufacturer_model_curated_tier_still_wins():
    # "B38M" is in the curated TYPE_CODE_TABLE -- icaolist must never be
    # reached, let alone override it.
    result = enrich_identity("ffffff", icao_type_code="B38M")
    assert result["manufacturer"]["value"] == "Boeing"
    assert result["manufacturer"]["source"] == "aircraft_type_db"


def test_enrich_identity_country_icaolist_registration_prefix_fallback():
    # "000001" falls in the (unallocated) hex block, so nothing above the
    # icaolist tiers can resolve country here -- isolates the prefix tier.
    result = enrich_identity("000001", registration="3A-ABC")
    assert result["country"]["value"] == "Monaco"
    assert result["country"]["source"] == "icaolist"


def test_enrich_identity_country_icaolist_hex_range_fallback():
    result = enrich_identity("899100")
    assert result["country"]["value"] == "Taiwan"
    assert result["country"]["source"] == "icaolist"


def test_enrich_identity_country_existing_tiers_still_outrank_icaolist():
    # "49d3d3" already resolves via the curated icao24_lookup tier --
    # icaolist must never be reached.
    result = enrich_identity("49d3d3")
    assert result["country"]["value"] == "Czech Republic"
    assert result["country"]["source"] == "icao24_lookup"


def test_enrich_identity_operator_icaolist_fallback_tier():
    result = enrich_identity("000001", callsign="AAE123")
    assert result["operator"]["value"] == "Air Atlanta Europe"
    assert result["operator"]["source"] == "icaolist"
    assert result["operator_country"]["value"] == "Malta"
    assert result["operator_country"]["source"] == "icaolist"


def test_enrich_identity_operator_existing_callsign_tier_still_outranks_icaolist():
    result = enrich_identity("ffffff", callsign="RYR123")
    assert result["operator"]["value"] == "Ryanair"
    assert result["operator"]["source"] == "callsign_decode"


def test_enrich_identity_operator_icaolist_needs_corroboration_on_hex_mismatch():
    # AAE (Malta) decoded on a Taiwan-block hex (via icaolist's own hex
    # tier) -- a real mismatch, so both operator and operator_country must
    # carry needs_corroboration, same corroboration signal callsign_decode
    # already gets.
    result = enrich_identity("899100", callsign="AAE123")
    assert result["operator"]["value"] == "Air Atlanta Europe"
    assert result["operator"]["needs_corroboration"] is True
    assert result["operator_country"]["needs_corroboration"] is True


def test_enrich_identity_c0_skips_icaolist_tiers():
    # Same short-circuit every other local lookup table gets for C-category
    # ground vehicles (see aircraft_enrichment.py's module docstring) --
    # icaolist must not be consulted either.
    result = enrich_identity(
        "899100", registration="3A-ABC", callsign="AAE123", icao_type_code="A124",
        category_code="C0",
    )
    assert result["country"] is None
    assert result["operator"] is None
    assert result["manufacturer"] is None
    assert result["model"] is None
