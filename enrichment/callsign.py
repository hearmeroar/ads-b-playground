"""ICAO 3-letter airline designator -> operator (+ that operator's home
country), decoded from the first 3 letters of a flight callsign.
"""

from .countries import country_by_iso

AIRLINE_OPERATORS = {
    "RYR": {"operator": "Ryanair", "country_iso": "IE"},
    "BAW": {"operator": "British Airways", "country_iso": "GB"},
    "AFR": {"operator": "Air France", "country_iso": "FR"},
    "DLH": {"operator": "Lufthansa", "country_iso": "DE"},
    "TVP": {"operator": "Smartwings", "country_iso": "CZ"},
    "UAE": {"operator": "Emirates", "country_iso": "AE"},
    "KLM": {"operator": "KLM Royal Dutch Airlines", "country_iso": "NL"},
    "AAL": {"operator": "American Airlines", "country_iso": "US"},
    "UAL": {"operator": "United Airlines", "country_iso": "US"},
    "DAL": {"operator": "Delta Air Lines", "country_iso": "US"},
    "SWA": {"operator": "Southwest Airlines", "country_iso": "US"},
    "EZY": {"operator": "easyJet", "country_iso": "GB"},
    "WZZ": {"operator": "Wizz Air", "country_iso": "HU"},
    "THY": {"operator": "Turkish Airlines", "country_iso": "TR"},
    "AUA": {"operator": "Austrian Airlines", "country_iso": "AT"},
    "SWR": {"operator": "Swiss International Air Lines", "country_iso": "CH"},
    "LOT": {"operator": "LOT Polish Airlines", "country_iso": "PL"},
    "CSA": {"operator": "CSA / Czech Airlines", "country_iso": "CZ"},
}

# Two independently-confidenced facts from one lookup: an operator name and
# that operator's home country. Kept separate (not two calls into two
# tables) since they come from the same designator and the orchestrator
# needs both, at different confidences, for two different priority chains.
OPERATOR_CONFIDENCE = 0.8
COUNTRY_CONFIDENCE = 0.6


def decode_callsign(callsign):
    """Callsign string -> {"operator", "source", "confidence", "country",
    "country_iso", "flag", "country_confidence"} or None.

    "country"/"country_iso"/"flag"/"country_confidence" are only present
    when the designator's home country is in countries.py.
    """
    if not callsign:
        return None
    code = callsign.strip().upper()[:3]
    entry = AIRLINE_OPERATORS.get(code)
    if not entry:
        return None

    result = {
        "operator": entry["operator"],
        "source": "callsign_decode",
        "confidence": OPERATOR_CONFIDENCE,
    }
    country = country_by_iso(entry.get("country_iso"))
    if country:
        result["country"] = country["name"]
        result["country_iso"] = country["iso"]
        result["flag"] = country["flag"]
        result["country_confidence"] = COUNTRY_CONFIDENCE
    return result
