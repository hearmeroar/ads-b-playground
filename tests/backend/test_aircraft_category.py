"""enrichment/aircraft_category.py: the static MTOW-derived (manufacturer,
model) -> ADS-B emitter category table, and its use as enrich_identity()'s
lowest-priority category fallback tier. No HTTP involved, same rationale as
test_enrichment.py's own registration/callsign/aircraft_type unit tests.
"""

from enrichment.aircraft_category import _CATEGORY_TABLE, category_for_aircraft
from enrichment.aircraft_database import TYPE_CODE_TABLE
from enrichment.aircraft_enrichment import enrich_identity


def test_category_for_aircraft_examples():
    assert category_for_aircraft("Cessna", "172") == "A1"          # light GA single
    assert category_for_aircraft("Boeing", "737 MAX 8") == "A3"    # narrow-body, past the 75,000 lb Large threshold
    assert category_for_aircraft("Boeing", "757-200") == "A4"      # the textbook high-vortex-large example
    assert category_for_aircraft("Boeing", "777-300ER") == "A5"    # wide-body heavy
    assert category_for_aircraft("Sikorsky", "S-76") == "A7"       # rotorcraft, regardless of weight


def test_category_for_aircraft_case_and_whitespace_insensitive():
    assert category_for_aircraft(" boeing ", " 737 max 8 ") == "A3"
    assert category_for_aircraft("BOEING", "737 MAX 8") == "A3"


def test_category_for_aircraft_unknown_returns_none():
    assert category_for_aircraft("Cessna", "Some Made Up Model") is None
    assert category_for_aircraft(None, "172") is None
    assert category_for_aircraft("Cessna", None) is None
    assert category_for_aircraft("", "") is None


def test_category_table_matches_type_code_table_1to1():
    # Every (manufacturer, model) pair this project's own TYPE_CODE_TABLE can
    # produce must resolve a category here, and vice versa — this table is
    # scoped exactly to that vocabulary, not a superset with invented extra
    # aircraft or a subset that silently drops coverage as TYPE_CODE_TABLE
    # grows.
    type_code_pairs = {(v["manufacturer"], v["model"]) for v in TYPE_CODE_TABLE.values()}
    category_pairs = set(_CATEGORY_TABLE.keys())
    assert type_code_pairs == category_pairs


def test_category_table_only_uses_real_do260b_codes():
    assert set(_CATEGORY_TABLE.values()) <= {"A1", "A2", "A3", "A4", "A5", "A6", "A7"}


def test_category_table_high_vortex_large_is_only_the_757():
    # A4 is a designation, not a weight band — confirm it's applied only to
    # the one type this table documents it for (Boeing 757), not silently
    # spread to other similarly-sized aircraft.
    a4_pairs = {pair for pair, code in _CATEGORY_TABLE.items() if code == "A4"}
    assert a4_pairs == {("Boeing", "757-200"), ("Boeing", "757-300")}


def test_category_table_rotorcraft_is_every_helicopter_regardless_of_weight():
    # R44 (a light piston helicopter) and S-92 (a heavy offshore helicopter)
    # sit at opposite ends of the weight spectrum but both must be A7 — DO-260B
    # assigns rotorcraft that code unconditionally, not by weight class.
    assert category_for_aircraft("Robinson", "R44") == "A7"
    assert category_for_aircraft("Sikorsky", "S-92") == "A7"


# --- enrich_identity() integration ---

def test_enrich_identity_category_icao24_tier():
    # 49d3d3 resolves manufacturer/model via the icao24 placeholder record
    # (Boeing / 737 MAX 8) with no category passed in at all.
    result = enrich_identity("49d3d3")
    assert result["category"]["value"] == "A3"
    assert result["category"]["source"] == "aircraft_category_db"
    assert result["category"]["confidence"] < 1.0


def test_enrich_identity_category_aircraft_type_tier():
    result = enrich_identity("ffffff", aircraft_type="B38M")
    assert result["category"]["value"] == "A3"


def test_enrich_identity_category_unknown_when_manufacturer_model_unresolved():
    assert enrich_identity("ffffff")["category"] is None


def test_route_identity_includes_category(client):
    resp = client.get("/api/identity/49d3d3")
    data = resp.get_json()
    assert data["category"]["value"] == "A3"


def test_route_identity_category_via_aircraft_type_param(client):
    resp = client.get("/api/identity/ffffff?aircraft_type=B38M")
    data = resp.get_json()
    assert data["category"]["value"] == "A3"
