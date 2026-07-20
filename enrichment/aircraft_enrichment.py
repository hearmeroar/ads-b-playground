"""Orchestrator: resolves each identity field through a priority chain,
short-circuiting at the first tier that produces a value. A live-feed value
(already known to the caller) always wins over every local lookup table —
enrichment only ever fills a gap the live feeds didn't cover.
"""

from .aircraft_category import category_for_aircraft
from .aircraft_database import DEFAULT_AIRCRAFT_DATABASE, normalize_aircraft_type
from .callsign import decode_callsign
from .countries import country_iso_for_name
from .registration import lookup_country_by_registration
from .manufacturer_aliases import normalize_manufacturer


def _live(value, confidence=1.0):
    return {"value": value, "source": "live", "confidence": confidence} if value else None


def enrich_identity(
    icao24,
    registration=None,
    callsign=None,
    aircraft_type=None,
    icao_type_code=None,
    known_country=None,
    known_operator=None,
    known_manufacture_year=None,
):
    """Returns a dict with all 8 keys always present: country, operator,
    operator_country, registration, manufacturer, model, year_built,
    category. Each is either None or {"value", "source", "confidence"} —
    "country" and "operator_country" additionally carry "country_iso"
    whenever resolved, so a flag can render regardless of which tier
    supplied the value (the frontend renders it via the flag-icons SVG
    library; this module never renders one itself). "country" always means
    the aircraft's country of *registration* (ICAO Annex 7 nationality
    mark); "operator_country" means the operating airline's home country —
    two distinct concepts, never conflated under one field. "operator_country"
    has no live tier (no live feed reports an operator's home country) —
    its only source is callsign_decode, a byproduct of the same lookup that
    resolves "operator" itself. "category" likewise has no live tier (the
    live ADS-B emitter category, when a source reports one, is resolved
    entirely on the frontend from the poll data — this module never sees
    it) — its value is the same "A1".."A7" DO-260B code the frontend's own
    OpenSky/adsb.fi/airplanes.live category handling already speaks, derived
    from whichever manufacturer/model this call resolved via
    `aircraft_category.py`'s static MTOW-based table, the lowest-priority
    fallback in the whole category chain.
    """
    db_record = DEFAULT_AIRCRAFT_DATABASE.lookup(icao24)
    reg_country = lookup_country_by_registration(registration)
    cs_decoded = decode_callsign(callsign)
    # icao_type_code (e.g. "B38M") is a standardized exact-match key and
    # checked first; aircraft_type is often a source's free-text description
    # (e.g. "BOEING 737 MAX 8") whose exact wording varies too much across
    # sources/aircraft to match TYPE_DESC_TABLE reliably, so it's only a
    # fallback for when no ICAO code was available at all.
    type_normalized = normalize_aircraft_type(icao_type_code) or normalize_aircraft_type(aircraft_type)

    # --- country ---
    country = _live(known_country)
    if country:
        # A live-sourced country string still gets a flag when its exact
        # name matches this table — the flag is a presentation add-on for a
        # value whose source/confidence stay "live"; it's not enrichment.
        iso = country_iso_for_name(known_country)
        if iso:
            country["country_iso"] = iso
    if not country and reg_country:
        country = {
            "value": reg_country["country"], "source": reg_country["source"],
            "confidence": reg_country["confidence"],
            "country_iso": reg_country["country_iso"],
        }
    if not country and db_record and db_record.get("country"):
        country = {
            "value": db_record["country"], "source": db_record["source"],
            "confidence": db_record["confidence"],
            "country_iso": db_record["country_iso"],
        }
    # Deliberately no callsign_decode tier for country: a callsign only
    # tells you the operator's home country, not the aircraft's country of
    # registration — conflating the two under one "Country" field is what
    # this fix removes. That data instead feeds the operator tier below.

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

    # --- operator_country (the operating airline's home country — a
    # distinct concept from "country", which is the aircraft's own
    # registration) ---
    operator_country = None
    if cs_decoded and cs_decoded.get("country"):
        operator_country = {
            "value": cs_decoded["country"], "source": cs_decoded["source"],
            "confidence": cs_decoded["country_confidence"],
            "country_iso": cs_decoded["country_iso"],
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
        # Normalize manufacturer names to a canonical form when possible
        manufacturer["value"] = normalize_manufacturer(manufacturer["value"])
        model = {
            "value": db_record["model"], "source": db_record["source"],
            "confidence": db_record["confidence"],
        }
    elif type_normalized:
        manufacturer = {
            "value": type_normalized["manufacturer"], "source": type_normalized["source"],
            "confidence": type_normalized["confidence"],
        }
        # Normalize the manufacturer discovered from type lookup too
        manufacturer["value"] = normalize_manufacturer(manufacturer["value"])
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

    # --- category (ADS-B emitter category, e.g. "A3") — the lowest-priority
    # fallback in this app's whole category chain: only reached when the
    # live feed reported no category at all *and* manufacturer+model were
    # resolved by one of the tiers above. Confidence is below 1.0 (unlike
    # the exact-match aircraft_type_db tier manufacturer/model themselves
    # use) since a specific tail number's real certified MTOW can vary
    # slightly by sub-variant/operator configuration in ways one
    # representative-per-model table can't capture.
    category = None
    if manufacturer and model:
        cat_code = category_for_aircraft(manufacturer["value"], model["value"])
        if cat_code:
            category = {"value": cat_code, "source": "aircraft_category_db", "confidence": 0.9}

    return {
        "country": country,
        "operator": operator,
        "operator_country": operator_country,
        "registration": reg,
        "manufacturer": manufacturer,
        "model": model,
        "year_built": year_built,
        "category": category,
    }
