"""The Country entity: name + ISO code, all in one place.

Every other enrichment module (registration.py, callsign.py,
aircraft_database.py) stores only an ISO code and resolves the display name
through country_by_iso() — so "Czech Republic" is spelled exactly once,
here. Flag rendering is a frontend presentation concern (static/index.html's
flagHtml(), via the flag-icons SVG library) — this module only ever hands
out the ISO code, never a rendered flag.
"""

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
COUNTRIES_BY_ISO = {c["iso"]: c for c in COUNTRIES}
COUNTRIES_BY_NAME = {c["name"].lower(): c["iso"] for c in COUNTRIES}


def country_by_iso(iso_code):
    """Returns {"name", "iso"} for a 2-letter ISO code, or None."""
    if not iso_code:
        return None
    return COUNTRIES_BY_ISO.get(iso_code.upper())


def country_iso_for_name(name):
    """Reverse lookup: country name -> ISO code, or None.

    Lets a live-sourced country string (e.g. OpenSky's own origin_country)
    still get a flag when its exact name happens to match this table — the
    flag is then a presentation add-on for a value whose source/confidence
    stay exactly as they were, not an enrichment result in its own right.
    Exact case-insensitive match only; no fuzzy matching, since a wrong
    match would show the wrong flag rather than just no flag.
    """
    if not name:
        return None
    return COUNTRIES_BY_NAME.get(name.strip().lower())
