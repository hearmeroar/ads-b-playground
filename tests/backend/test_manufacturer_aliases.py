import pytest

from enrichment.manufacturer_aliases import normalize_manufacturer


def test_known_aliases_normalize():
    # exact-case
    assert normalize_manufacturer("de Havilland Canada") == "De Havilland"
    # different-case and trimmed
    assert normalize_manufacturer("  aermacchi ") == "Leonardo"
    # alias mapping with long name
    assert normalize_manufacturer("Airbus Defence and Space") == "Airbus"


def test_unknown_returns_stripped():
    assert normalize_manufacturer("Some Unknown Maker") == "Some Unknown Maker"


def test_none_returns_none():
    assert normalize_manufacturer(None) is None
