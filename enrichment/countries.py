"""The Country entity: name + ISO code + flag, all in one place.

Every other enrichment module (registration.py, callsign.py,
aircraft_database.py) stores only an ISO code and resolves the display name
and flag through country_by_iso() — so "Czech Republic" and its flag are
spelled exactly once, here.
"""


def _flag_emoji(iso_code):
    """2-letter ISO code -> Unicode regional-indicator flag emoji.

    Modeled as its own function (not inlined into each country record by
    hand) so the emoji rendering can later be swapped for something else
    (e.g. an image asset) without touching any of the country data itself.
    """
    return "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in iso_code.upper())


COUNTRIES = [
    {"name": "United States", "iso": "US"},
    {"name": "United Kingdom", "iso": "GB"},
    {"name": "Germany", "iso": "DE"},
    {"name": "Czech Republic", "iso": "CZ"},
    {"name": "Serbia", "iso": "RS"},
    {"name": "France", "iso": "FR"},
    {"name": "Italy", "iso": "IT"},
    {"name": "Ireland", "iso": "IE"},
    {"name": "Netherlands", "iso": "NL"},
    {"name": "Poland", "iso": "PL"},
    {"name": "Hungary", "iso": "HU"},
    {"name": "Austria", "iso": "AT"},
    {"name": "Switzerland", "iso": "CH"},
    {"name": "Spain", "iso": "ES"},
    {"name": "Croatia", "iso": "HR"},
    {"name": "Romania", "iso": "RO"},
    {"name": "Bulgaria", "iso": "BG"},
    {"name": "Greece", "iso": "GR"},
    {"name": "Turkey", "iso": "TR"},
    {"name": "Belgium", "iso": "BE"},
    {"name": "United Arab Emirates", "iso": "AE"},
]
# Extendable placeholder set, not exhaustive — add more entries as needed.
for _c in COUNTRIES:
    _c["flag"] = _flag_emoji(_c["iso"])

COUNTRIES_BY_ISO = {c["iso"]: c for c in COUNTRIES}


def country_by_iso(iso_code):
    """Returns {"name", "iso", "flag"} for a 2-letter ISO code, or None."""
    if not iso_code:
        return None
    return COUNTRIES_BY_ISO.get(iso_code.upper())
