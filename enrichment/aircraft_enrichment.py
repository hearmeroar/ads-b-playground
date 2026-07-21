"""Orchestrator: resolves each identity field through a priority chain,
short-circuiting at the first tier that produces a value. A live-feed value
(already known to the caller) always wins over every local lookup table —
enrichment only ever fills a gap the live feeds didn't cover.
"""

from .aircraft_category import category_for_aircraft
from .aircraft_database import DEFAULT_AIRCRAFT_DATABASE, normalize_aircraft_type
from .callsign import decode_callsign
from .countries import country_iso_for_name
from .icao24_allocation import country_for_icao24
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
    category_code=None,
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

    **Special case: C-category ground vehicles (C0-C5)** —
    When category_code is a C-category code (C0-C5 per DO-260B, representing
    surface vehicles, obstacles, and other non-aircraft), this function
    short-circuits entirely: it returns only whatever the live feed itself
    already reported (known_country/known_operator/registration/
    known_manufacture_year, passed straight through with no lookup), and
    everything else — country/operator/registration filled from a local
    table, plus operator_country/manufacturer/model/category, which have no
    live tier at all — is always None. No local lookup table (registration
    prefix, ICAO24 block, callsign decode, the exact-match aircraft
    database, type-code normalization, or the MTOW-derived category table)
    is ever consulted for these categories, including the aircraft-database
    exact-match tier: a ground vehicle's ICAO24 was never meant to key into
    a *real aircraft* database in the first place, so even an apparent exact
    match there is not trustworthy for it. This was tightened from an
    earlier version that only skipped the three most obviously
    registration/callsign-dependent tiers (registration_prefix, icao24_block,
    callsign_decode) but still ran the database/type-code tiers — found
    live: a real C0 aircraft still resolved a plausible-looking but entirely
    wrong Operator ("Taxi Aereo Cozatl") and Registration Country
    ("Bulgaria") this way. Only adsbdb (a separate, external database
    queried on the frontend, not this module) or the live feed itself can
    supply these fields for a C-category object now.

    A callsign-decoded operator/operator_country is a real ICAO 3LD
    designator match, but a static ~5700-entry table has no way to know a
    given designator is defunct/recycled, nor that a non-commercial
    (government/EMS/police/military) aircraft's callsign prefix can
    coincidentally collide with an unrelated real airline's code (found via
    a real aircraft: a Romanian rescue helicopter's "MAI" callsign prefix —
    short for Ministerul Afacerilor Interne, the Ministry of Internal
    Affairs — decoding to "Mauritania Airlines International"). Since the
    aircraft's own ICAO24 hex address is assigned directly by its actual
    State of Registry (`icao24_allocation.py`), independent of both the
    registration string and the callsign, a disagreement between the two is
    a real corroboration signal: whenever "operator"/"operator_country" end
    up sourced from `callsign_decode` and `country_for_icao24(icao24)`
    resolves to a *different* country than the callsign decode did, that
    field gains `needs_corroboration: True`. The value is never dropped
    here — an operator's home country legitimately differs from the
    aircraft's own registration country extremely often for ordinary
    reasons (cross-border leasing, flag-of-convenience registries), so
    hiding it outright at this layer would suppress a lot of correct data.
    This module always returns everything it resolves, flag included; only
    the frontend decides what to do with the flag, and does so more
    aggressively for rotorcraft specifically (see CLAUDE.md) since a
    genuine cross-border "airline" helicopter flight under a matching ICAO
    3LD designator is rare, while this exact collision pattern is not.
    """
    # C-category ground vehicles (C0-C5: surface vehicles, obstacles, etc.)
    # short-circuit entirely — see the docstring above. Only the live tier
    # (already known to the caller) is returned; no local lookup table is
    # ever consulted for these categories.
    is_ground_vehicle = bool(category_code and category_code.startswith("C"))
    if is_ground_vehicle:
        country = _live(known_country)
        if country:
            iso = country_iso_for_name(known_country)
            if iso:
                country["country_iso"] = iso
        return {
            "country": country,
            "operator": _live(known_operator),
            "operator_country": None,
            "registration": _live(registration),
            "manufacturer": None,
            "model": None,
            "year_built": _live(known_manufacture_year),
            "category": None,
        }

    db_record = DEFAULT_AIRCRAFT_DATABASE.lookup(icao24)
    reg_country = lookup_country_by_registration(registration)
    cs_decoded = decode_callsign(callsign)
    icao24_country = country_for_icao24(icao24)
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
    if not country and db_record and db_record.get("country"):
        country = {
            "value": db_record["country"], "source": db_record["source"],
            "confidence": db_record["confidence"],
            "country_iso": db_record["country_iso"],
        }
    if not country and reg_country:
        country = {
            "value": reg_country["country"], "source": reg_country["source"],
            "confidence": reg_country["confidence"],
            "country_iso": reg_country["country_iso"],
        }
    if not country and icao24_country:
        country = {
            "value": icao24_country["country"], "source": icao24_country["source"],
            "confidence": icao24_country["confidence"],
            "country_iso": icao24_country["country_iso"],
        }
    # Deliberately no callsign_decode tier for country: a callsign only
    # tells you the operator's home country, not the aircraft's country of
    # registration — conflating the two under one "Country" field is what
    # this fix removes. That data instead feeds the operator tier below.

    # A callsign-decoded operator's claimed home country disagreeing with
    # the aircraft's own ICAO24-block country is a real corroboration gap —
    # see the module docstring. Computed once, applied to both "operator"
    # and "operator_country" below (whichever of the two actually ends up
    # sourced from callsign_decode).
    cs_needs_corroboration = bool(
        cs_decoded
        and cs_decoded.get("country_iso")
        and icao24_country
        and cs_decoded["country_iso"] != icao24_country["country_iso"]
    )

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
        if cs_needs_corroboration:
            operator["needs_corroboration"] = True

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
        if cs_needs_corroboration:
            operator_country["needs_corroboration"] = True

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
