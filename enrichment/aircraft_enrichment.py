"""Orchestrator: resolves each identity field through a priority chain,
short-circuiting at the first tier that produces a value. A live-feed value
(already known to the caller) always wins over every local lookup table —
enrichment only ever fills a gap the live feeds didn't cover.
"""

from .aircraft_database import DEFAULT_AIRCRAFT_DATABASE, normalize_aircraft_type
from .callsign import decode_callsign
from .registration import lookup_country_by_registration


def _live(value, confidence=1.0):
    return {"value": value, "source": "live", "confidence": confidence} if value else None


def enrich_identity(
    icao24,
    registration=None,
    callsign=None,
    aircraft_type=None,
    known_country=None,
    known_operator=None,
    known_manufacture_year=None,
):
    """Returns a dict with all 6 keys always present: country, operator,
    registration, manufacturer, model, year_built. Each is either None or
    {"value", "source", "confidence"} — "country" additionally carries
    "country_iso" and "flag".
    """
    db_record = DEFAULT_AIRCRAFT_DATABASE.lookup(icao24)
    reg_country = lookup_country_by_registration(registration)
    cs_decoded = decode_callsign(callsign)
    type_normalized = normalize_aircraft_type(aircraft_type)

    # --- country ---
    country = _live(known_country)
    if not country and reg_country:
        country = {
            "value": reg_country["country"], "source": reg_country["source"],
            "confidence": reg_country["confidence"],
            "country_iso": reg_country["country_iso"], "flag": reg_country["flag"],
        }
    if not country and db_record and db_record.get("country"):
        country = {
            "value": db_record["country"], "source": db_record["source"],
            "confidence": db_record["confidence"],
            "country_iso": db_record["country_iso"], "flag": db_record["flag"],
        }
    if not country and cs_decoded and cs_decoded.get("country"):
        country = {
            "value": cs_decoded["country"], "source": cs_decoded["source"],
            "confidence": cs_decoded["country_confidence"],
            "country_iso": cs_decoded["country_iso"], "flag": cs_decoded["flag"],
        }

    # --- operator ---
    operator = _live(known_operator)
    if not operator and db_record and db_record.get("operator"):
        operator = {
            "value": db_record["operator"], "source": db_record["source"],
            "confidence": db_record["confidence"],
        }
    if not operator and cs_decoded:
        operator = {
            "value": cs_decoded["operator"], "source": cs_decoded["source"],
            "confidence": cs_decoded["confidence"],
        }

    # --- registration ---
    reg = _live(registration)
    if not reg and db_record and db_record.get("registration"):
        reg = {
            "value": db_record["registration"], "source": db_record["source"],
            "confidence": db_record["confidence"],
        }

    # --- manufacturer / model (no live tier — no existing field for these) ---
    manufacturer = None
    model = None
    if db_record and db_record.get("manufacturer"):
        manufacturer = {
            "value": db_record["manufacturer"], "source": db_record["source"],
            "confidence": db_record["confidence"],
        }
        model = {
            "value": db_record["model"], "source": db_record["source"],
            "confidence": db_record["confidence"],
        }
    elif type_normalized:
        manufacturer = {
            "value": type_normalized["manufacturer"], "source": type_normalized["source"],
            "confidence": type_normalized["confidence"],
        }
        model = {
            "value": type_normalized["model"], "source": type_normalized["source"],
            "confidence": type_normalized["confidence"],
        }

    # --- year_built ---
    year_built = _live(known_manufacture_year)
    if not year_built and db_record and db_record.get("year_built"):
        year_built = {
            "value": db_record["year_built"], "source": db_record["source"],
            "confidence": db_record["confidence"],
        }

    return {
        "country": country,
        "operator": operator,
        "registration": reg,
        "manufacturer": manufacturer,
        "model": model,
        "year_built": year_built,
    }
