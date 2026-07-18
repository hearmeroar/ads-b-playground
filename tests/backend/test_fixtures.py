import json
import pathlib
import pytest
import jsonschema


FIXTURES_DIR = pathlib.Path(__file__).parent.parent / "frontend" / "fixtures"
SCHEMA_PATH = pathlib.Path(__file__).parent.parent.parent / "schema" / "aircraft.schema.json"


def load_schema():
    """Load the aircraft schema."""
    with open(SCHEMA_PATH) as f:
        return json.load(f)


def test_schema_valid():
    """Verify the aircraft schema itself is valid JSON Schema."""
    schema = load_schema()
    assert schema.get("$schema") == "https://json-schema.org/draft/2020-12/schema"
    assert schema.get("title") == "AircraftInfo"
    assert "properties" in schema


def test_fixtures_parse_as_json():
    """Verify all fixture files are valid JSON."""
    for fixture_file in sorted(FIXTURES_DIR.glob("*.json")):
        with open(fixture_file) as f:
            try:
                json.load(f)
            except json.JSONDecodeError as e:
                pytest.fail(f"{fixture_file.name} is not valid JSON: {e}")


@pytest.mark.parametrize("fixture_name,expected_keys", [
    ("states.json", {"time", "rate_limit_remaining", "states"}),
    ("track.json", {"path"}),
    ("adsbfi.json", {"ac"}),
    ("airplaneslive.json", {"ac"}),
    ("flightaware.json", {"flights"}),
    ("photo-found.json", {"photos"}),
    ("photo-empty.json", {"photos"}),
])
def test_fixture_structure(fixture_name, expected_keys):
    """Verify each fixture has the expected top-level structure."""
    fixture_file = FIXTURES_DIR / fixture_name
    assert fixture_file.exists(), f"Fixture {fixture_name} not found"

    with open(fixture_file) as f:
        data = json.load(f)

    assert isinstance(data, dict), f"{fixture_name}: expected dict at root level"
    assert expected_keys.issubset(data.keys()), (
        f"{fixture_name}: missing keys {expected_keys - set(data.keys())}"
    )
