"""Nearest-airport lookup for the aircraft collection's "where was it seen"
feature (app.py's api_collection_save()) — answers "what's nearby" for a
saved aircraft's position without any external API call or key, matching
this package's existing local-static-table convention. Also holds the
airport-marker dataset for the map's "Airports" layer (`list_map_airports()`/
`airports_in_bbox()` below) — a separate dataset, since it needs a
different source (size/type classification, see below) than the
nearest-airport table.

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

**Map-layer data is a second, deliberately different dataset**,
`enrichment/data/ourairports.json` (85,776 entries, ~16 MB), generated from
[OurAirports](https://ourairports.com/data/)'s `airports.csv` (Public
Domain / CC0, updated nightly, hosted at
`https://github.com/davidmegginson/ourairports-data` — mirrored at
`https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv`),
not the OpenFlights table above, because OurAirports is the one of the two
that classifies each row's `type` (`large_airport`/`medium_airport`/
`small_airport`/`heliport`/`seaplane_base`/`balloonport`/`closed`) — needed
so the map layer can render airports differently by size and can skip
`closed` ones, neither of which OpenFlights' `airports.dat` supports (its
own `type` column is dropped entirely when generating `airports.json`
above). Regenerate the same one-off/uncommitted way: download
`airports.csv` from the URL above, parse with `csv.DictReader`, drop rows
with no `name`/unparseable `latitude_deg`/`longitude_deg`, and write
`{ident, type, name, lat, lon, elevation_ft, country, municipality, iata,
icao}` per row as compact JSON, sorted by type-priority (large → medium →
small → heliport → seaplane_base → balloonport → closed) then name for a
readable diff.

**Global, like the OpenFlights table above — every airport worldwide is
kept in memory, not just this app's own coverage area** (explicit product
decision: an earlier draft of this feature pre-filtered the *stored* data
to a 600 km radius around `AREA_CENTER`, which was reverted after the
project owner asked for every airport to be available, not just a curated
regional slice). This is by far the largest vendored dataset in this repo
(~16 MB vs. `opensky_year_built.json`'s 3.3 MB, the previous largest) —
accepted since the feature's whole point is that every airport is there to
be shown, wherever the map happens to be looking.

**What actually reaches the browser is a different story**: nothing calls
`list_map_airports()` over HTTP directly — `/api/airports` (app.py) always
goes through `airports_in_bbox()`, scoped to the map's *current viewport*,
re-fetched on pan/zoom (see `static/js/map-init.js`'s Airports-layer
section). Panning from Belgrade to another region re-queries this same
in-memory table for whatever's newly in view — the stored data doesn't
change, only which slice of it gets requested. `Leaflet.markercluster` is
vendored/wired on top of that as a second line of defense for a
zoomed-out viewport that still spans thousands of airports (e.g. a whole
continent) — the two techniques solve different problems: bbox filtering
keeps the *dataset* scoped to what's relevant, clustering keeps the *map*
readable when that scope is still visually dense.

**A second, independent filter narrows this further to the app's own scan
zone** (`airports_in_bbox()`'s `center`/`radius_km` params, wired from
`app.py`'s `AREA_CENTER`/`AREA_RADIUS_NM` — the same circle the scan-radius
range rings draw): an airport can be inside the current viewport bbox and
still get dropped if it's outside that circle. The stored dataset stays
exactly as global as described above — this is purely a rendering
restriction, not a re-filter of what's kept in memory — so if `AREA_CENTER`
ever moves, every airport is still there to show, just under a
recentered circle.
"""

import json
import math
import os

from .countries import country_by_iso

_AIRPORTS_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "airports.json")
_MAP_AIRPORTS_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "ourairports.json")


def _load_airports():
    try:
        with open(_AIRPORTS_DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        # Missing/corrupt vendored data file degrades to "no airports at
        # all" rather than crashing the whole enrichment module — same
        # tolerance as aircraft_database.py's _load_generated_year_built().
        return []


def _load_map_airports():
    try:
        with open(_MAP_AIRPORTS_DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        # Same tolerance as _load_airports() above — a missing/corrupt file
        # just means the map layer has nothing to show, not a crash.
        return []


_AIRPORTS = _load_airports()
_MAP_AIRPORTS = _load_map_airports()

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


def list_map_airports(include_closed=False, types=None):
    """Every airport worldwide for the map's "Airports" layer (see the
    module docstring for why this dataset is global rather than scoped to
    this app's coverage area).

    `closed` airports are dropped by default: showing a defunct airport as
    if it were an active one would be misleading, and it's a judgment call
    this function makes so callers don't have to remember to filter it
    themselves. Pass `include_closed=True` to get the full list anyway.

    `types`, when given, is an iterable of OurAirports `type` values
    (`large_airport`/`medium_airport`/`small_airport`/`heliport`/
    `seaplane_base`/`balloonport`) — only airports whose `type` is in it are
    kept. This is what backs the frontend's per-size checklist (large/medium
    airports shown by default, the rest opt-in) — `None` (the default)
    means no type restriction, same as before this filter existed.

    Each entry's raw `country` field is OurAirports' own 2-letter ISO code
    (e.g. "RS"), not a display name — a `country_name` key (e.g. "Serbia")
    is added here via `country_by_iso()` (the same lookup `countries.py`
    already provides for the aircraft sidebar's own country rows) so the
    map popup doesn't have to show a bare code. `None` when the code isn't
    in `countries.py`'s table — a real, accepted limitation, same as the
    sidebar's own flag/name resolution elsewhere in this app.
    """
    source = _MAP_AIRPORTS if include_closed else (a for a in _MAP_AIRPORTS if a.get("type") != "closed")
    if types is not None:
        types = set(types)
        source = (a for a in source if a.get("type") in types)
    result = []
    for a in source:
        country = country_by_iso(a.get("country"))
        result.append({**a, "country_name": country["name"] if country else None})
    return result


def search_airports(query, limit=20):
    """Search OurAirports dataset for airports matching the query string.

    Returns up to `limit` airports (capped at 50 server-side, never more).
    Search is case-insensitive and matches across name, IATA, ICAO,
    municipality, and country_name fields.

    Ranking, four tiers, in order: (1) exact IATA/ICAO code match, (2) the
    query is a prefix of the *whole* name/municipality/country (e.g. "lon"
    → "London..."), (3) the query is a prefix of some *word* within one of
    those fields (e.g. "heathrow" → "London Heathrow Airport" — without this
    tier, a query matching the second/third word of a well-known airport's
    name would rank below an obscure airport whose name happens to start
    with that word, which is backwards from what a user searching by a
    recognizable landmark name expects), (4) any substring match anywhere
    else. Preserves file order within each tier (large/medium/small
    airports first, per the vendored data's own sort order).

    Returns a list of airport dicts with fields: ident, type, name, lat, lon,
    elevation_ft, country, municipality, iata, icao, country_name.
    """
    if not query or not _MAP_AIRPORTS:
        return []

    query = query.strip().lower()
    if len(query) < 2:
        return []

    limit = min(int(limit or 20), 50)

    exact_matches = []
    prefix_matches = []
    word_prefix_matches = []
    substring_matches = []

    for a in _MAP_AIRPORTS:
        if a.get("type") == "closed":
            continue

        # Build searchable fields
        iata_lower = (a.get("iata") or "").lower()
        icao_lower = (a.get("icao") or "").lower()
        name_lower = (a.get("name") or "").lower()
        municipality_lower = (a.get("municipality") or "").lower()
        country_iso = a.get("country")
        country_obj = country_by_iso(country_iso)
        country_name_lower = (country_obj["name"] if country_obj else "").lower()

        fields = [name_lower, municipality_lower, country_name_lower]

        if iata_lower == query or icao_lower == query:
            exact_matches.append(a)
        elif any(f.startswith(query) for f in fields):
            prefix_matches.append(a)
        elif any(word.startswith(query) for f in fields for word in f.split()):
            word_prefix_matches.append(a)
        elif any(query in f for f in fields) or query in iata_lower or query in icao_lower:
            substring_matches.append(a)

    result = exact_matches + prefix_matches + word_prefix_matches + substring_matches

    # Add country_name to each result (matching list_map_airports() behavior)
    enriched = []
    for a in result[:limit]:
        country_obj = country_by_iso(a.get("country"))
        enriched.append({**a, "country_name": country_obj["name"] if country_obj else None})

    return enriched


def airports_in_bbox(lamin, lomin, lamax, lomax, include_closed=False, center=None, radius_km=None, types=None):
    """Airports within a lat/lon bounding box — what the frontend actually
    renders. The full global list is stored (see the module docstring), but
    a live map only ever needs whatever's in view: `/api/airports` calls
    this with the current viewport's bounds (re-fetched on pan/zoom, same
    "only load what's visible" idea as any tile layer), rather than ever
    shipping the whole ~85,000-row dataset to the browser at once.

    `center`/`radius_km`, when both given, apply a second, independent
    filter: only airports within `radius_km` of `center` (a `(lat, lon)`
    tuple) survive, on top of the bbox check above. This is what scopes the
    layer to the app's own scan zone (`AREA_CENTER`/`AREA_RADIUS_NM` in
    app.py — the same circle the scan-radius range rings draw) rather than
    to *whatever* the viewport happens to be showing: panning away from the
    scan zone still queries this function with the new viewport's bbox, but
    the radius filter now empties the result instead of showing airports
    the app never actually covers. The full dataset is untouched either
    way — this only narrows what a given call returns.

    `types` is passed straight through to `list_map_airports()` — see there
    for its shape.

    Invalid bounds (non-numeric, or a degenerate box) return an empty list
    rather than raising — a malformed viewport shouldn't 500 the request.
    """
    try:
        lamin, lomin, lamax, lomax = float(lamin), float(lomin), float(lamax), float(lomax)
    except (TypeError, ValueError):
        return []
    if lamin > lamax or lomin > lomax:
        return []
    result = [
        a for a in list_map_airports(include_closed=include_closed, types=types)
        if lamin <= a["lat"] <= lamax and lomin <= a["lon"] <= lomax
    ]
    if center is not None and radius_km is not None:
        center_lat, center_lon = center
        result = [a for a in result if _haversine_km(center_lat, center_lon, a["lat"], a["lon"]) <= radius_km]
    return result
