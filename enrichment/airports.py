"""Nearest-airport lookup for the aircraft collection's "where was it seen"
feature (app.py's api_collection_save()) — answers "what's nearby" for a
saved aircraft's position without any external API call or key, matching
this package's existing local-static-table convention.

Data: `enrichment/data/airports.json`, 7698 entries generated from the
[OpenFlights](https://github.com/jpatokal/openflights) project's
`data/airports.dat` (ODbL/DbCL licensed — the same source/license already
used for `callsign.py`'s AIRLINE_OPERATORS generated tier). Regenerate with
a one-off, uncommitted script (same convention as `opensky_year_built.json`
and the airline-logo manifest): download `airports.dat` from
`https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat`,
parse with `csv.reader` (columns: id, name, city, country, IATA, ICAO, lat,
lon, altitude, timezone, DST, tz name, type, source — `"\\N"` marks a
missing value), keep every row with a name and parseable lat/lon, and write
`{name, city, country, iata, icao, lat, lon}` per row as compact JSON.

No trimming to this app's own coverage area (Balkans) was done — a flat
Python scan over ~7700 rows is sub-millisecond, and a collection save is a
rare, click-driven, per-aircraft event, not a per-poll cost — so keeping
the whole world's airports costs nothing here and means the lookup still
works correctly if this app's AREA_CENTER ever moves.
"""

import json
import math
import os

_AIRPORTS_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "airports.json")


def _load_airports():
    try:
        with open(_AIRPORTS_DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        # Missing/corrupt vendored data file degrades to "no airports at
        # all" rather than crashing the whole enrichment module — same
        # tolerance as aircraft_database.py's _load_generated_year_built().
        return []


_AIRPORTS = _load_airports()

_EARTH_RADIUS_KM = 6371.0


def _haversine_km(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def nearest_airport(lat, lon):
    """Closest airport to (lat, lon) as {name, city, country, iata, icao,
    distance_km}, or None if the table failed to load or coordinates are
    invalid.
    """
    if lat is None or lon is None or not _AIRPORTS:
        return None
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None

    best = None
    best_distance = None
    for airport in _AIRPORTS:
        distance = _haversine_km(lat, lon, airport["lat"], airport["lon"])
        if best_distance is None or distance < best_distance:
            best, best_distance = airport, distance

    if best is None:
        return None
    return {
        "name": best["name"], "city": best.get("city"), "country": best.get("country"),
        "iata": best.get("iata"), "icao": best.get("icao"),
        "distance_km": round(best_distance, 1),
    }
