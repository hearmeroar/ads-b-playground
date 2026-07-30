"""ICAO type designator / registration prefix / ICAO24 hex range / airline
designator lookups sourced from rikgale/ICAOList
(https://github.com/rikgale/ICAOList), a community-maintained reference
dataset originally built for that author's own VRSOperatorFlags project. No
LICENSE file in that repo -- same "no formal license, used with attribution
as a bottom-tier fallback only" posture already accepted elsewhere in this
project for airframesio/airline-images (see CLAUDE.md's Airline logos
section).

Vendored as 4 generated JSON files (enrichment/data/icaolist_*.json, via a
one-off, uncommitted script -- same "regenerate by hand" convention as
opensky_year_built.json/the airline-logos manifest):
- icaolist_types.json: ICAO type designator -> {manufacturer, model}
  (2765 entries, vs. aircraft_database.py's own ~150 hand-curated
  TYPE_CODE_TABLE entries)
- icaolist_reg_prefixes.json: registration prefix -> country ISO
  (219 entries; a topup for registration.py's own 193-entry table)
- icaolist_hex_ranges.json: [start, end, iso] ICAO24 blocks (185 entries;
  a topup for icao24_allocation.py's own 184-entry table)
- icaolist_airlines.json: ICAO 3-letter designator -> {name, country_iso}
  (1890 entries; generated with every code already present in callsign.py's
  own AIRLINE_OPERATORS excluded, so this is a genuine topup, not a
  duplicate -- callsign.py's ~5700-entry OpenFlights-generated tier already
  covers essentially every real commercial designator)

Every lookup here is a **bottom-tier fallback**: aircraft_enrichment.py only
ever consults it after the matching hand-curated/generated table in
registration.py/icao24_allocation.py/callsign.py/aircraft_database.py has
already come up empty. This dataset is broader but less vetted --
community-maintained, ALL-CAPS source data, and (for airlines especially)
includes many obscure/defunct operators and even military flight units
alongside real carriers -- so its confidence values sit below the
equivalent existing-tier constant it backs up, and it must never override a
more trusted tier even though the priority chain already guarantees that.

Unlike every other enrichment/ tier, a field resolved here is tagged with
its own distinct `source: "icaolist"` rather than being folded into
"Flywme" the way registration_prefix/icao24_lookup/callsign_decode/
aircraft_type_db all are -- an explicit product decision (2026-07-30) so
this dataset's contribution stays visible and independently toggleable
(its own dev-mode source badge + toggle, static/js/state-filters.js),
rather than disappearing anonymously into Flywme's single black badge.

**Known limitation**: ~30 of RegPrefixList.csv/ICAOHexRange.csv's country
names are UK/French/Dutch overseas territories or Crown dependencies
(Bermuda, Gibraltar, Guernsey, Jersey, Isle of Man, Cayman Islands, French
Guiana, Kosovo, ...) that have their own registration prefix/ICAO24 block
but no distinct entry in this project's own countries.py (scoped to ICAO
member states, not sub-national territories) -- those rows were dropped at
generation time rather than force-mapped to an unrelated parent state, the
same "not exhaustive" acceptance countries.py's own docstring already
documents for very small territories.
"""

import json
import os

from .countries import country_by_iso

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def _load_json(filename, default):
    try:
        with open(os.path.join(_DATA_DIR, filename), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        # Missing/corrupt vendored data degrades to "no icaolist tier"
        # rather than crashing enrichment -- same tolerance as every other
        # vendored-JSON loader in this package.
        return default


_TYPES = _load_json("icaolist_types.json", {})
_REG_PREFIXES = _load_json("icaolist_reg_prefixes.json", {})
_HEX_RANGES = _load_json("icaolist_hex_ranges.json", [])
_AIRLINES = _load_json("icaolist_airlines.json", {})

SOURCE = "icaolist"

# Each sits below the equivalent existing-tier constant this lookup backs
# up: aircraft_type_db's 1.0, registration_prefix's 1.0, icao24_block's
# 0.85, callsign_decode's 0.8 (operator) / 0.6 (country).
TYPE_CONFIDENCE = 0.8
REG_PREFIX_CONFIDENCE = 0.8
HEX_RANGE_CONFIDENCE = 0.7
AIRLINE_OPERATOR_CONFIDENCE = 0.6
AIRLINE_COUNTRY_CONFIDENCE = 0.5


def lookup_type(icao_type_code):
    """ICAO type designator (e.g. "B38M") -> {"manufacturer", "model",
    "source", "confidence"} or None. Exact-match only, against this
    dataset's own designator table -- not consulted for a source's
    free-text description (aircraft_database.py's TYPE_DESC_TABLE has no
    ICAOList equivalent).
    """
    if not icao_type_code:
        return None
    entry = _TYPES.get(icao_type_code.strip().upper())
    if not entry:
        return None
    return {
        "manufacturer": entry["manufacturer"], "model": entry["model"],
        "source": SOURCE, "confidence": TYPE_CONFIDENCE,
    }


def country_for_registration_prefix(registration):
    """Registration string -> {"country", "country_iso", "source",
    "confidence"} or None. Same candidate-building strategy as
    registration.py's own lookup_country_by_registration() -- including its
    short-military-serial guard ("ZM337"-style: a 2-letter chunk followed
    by >=3 digits is a government/military serial, not a civil nationality
    mark, so it only ever tries the 3-char composite candidate, never falls
    back to 2- or 1-char) -- applied to this (smaller, topup-only) prefix
    table. Duplicating the guard here (rather than importing it) matters:
    without it, a real regression was caught in testing where "ZM337" (a
    military serial) fell back to its bare "Z" candidate and falsely
    resolved a country via this table even though registration.py's own
    table correctly declines to.
    """
    if not registration:
        return None
    reg = registration.strip().upper()
    if not reg:
        return None

    candidates = []
    if "-" in reg:
        before, _, after = reg.partition("-")
        if after:
            candidates.append(before + after[0])
        candidates.append(before)
    elif len(reg) >= 5 and reg[:2].isalpha() and reg[2:].isdigit() and len(reg[2:]) >= 3:
        candidates.append(reg[:3])
    else:
        candidates.extend([reg[:3], reg[:2], reg[:1]])

    for prefix in candidates:
        iso = _REG_PREFIXES.get(prefix)
        if iso:
            country = country_by_iso(iso)
            if country:
                return {
                    "country": country["name"], "country_iso": country["iso"],
                    "source": SOURCE, "confidence": REG_PREFIX_CONFIDENCE,
                }
    return None


def country_for_icao24_hex(icao24):
    """ICAO24 hex string -> {"country", "country_iso", "source",
    "confidence"} or None for invalid/unallocated input. Linear scan over
    ~185 rows -- click-triggered, same rationale as icao24_allocation.py's
    own scan.
    """
    if not icao24:
        return None
    try:
        value = int(str(icao24).strip(), 16)
    except ValueError:
        return None
    if not (0 <= value <= 0xFFFFFF):
        return None

    for start, end, iso in _HEX_RANGES:
        if start <= value <= end:
            country = country_by_iso(iso)
            if country:
                return {
                    "country": country["name"], "country_iso": country["iso"],
                    "source": SOURCE, "confidence": HEX_RANGE_CONFIDENCE,
                }
            return None
    return None


def lookup_airline(callsign):
    """Callsign string -> {"operator", "source", "confidence", "country",
    "country_iso", "country_confidence"} or None. Same first-3-letters
    convention as callsign.py's own decode_callsign() -- this table only
    ever holds codes NOT already in callsign.py's AIRLINE_OPERATORS (see
    the module docstring), so the two tables never disagree on a shared
    code; this is purely a second-chance table for codes that tier misses.
    """
    if not callsign:
        return None
    code = callsign.strip().upper()[:3]
    entry = _AIRLINES.get(code)
    if not entry:
        return None

    result = {
        "operator": entry["name"], "source": SOURCE,
        "confidence": AIRLINE_OPERATOR_CONFIDENCE,
    }
    country = country_by_iso(entry.get("country_iso"))
    if country:
        result["country"] = country["name"]
        result["country_iso"] = country["iso"]
        result["country_confidence"] = AIRLINE_COUNTRY_CONFIDENCE
    return result
