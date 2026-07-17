"""
Minimal backend for the "live aircraft on a map" MVP.

Backend responsibilities:
1) Serve the static frontend (index.html with the Leaflet map).
2) Proxy /states/all from OpenSky Network — needed because OpenSky doesn't
   send CORS headers for arbitrary origins, so the browser can't read the
   response from a direct frontend fetch.
3) Cache the response for a few seconds and survive 429s / network errors,
   since OpenSky access is rate-limited per day.
4) If OPENSKY_CLIENT_ID/OPENSKY_CLIENT_SECRET are set (see .env.example),
   authenticate with OpenSky via OAuth2 client_credentials — this gives a
   much higher daily quota than anonymous access. Without them, the backend
   just falls back to anonymous requests.
5) Proxy /tracks/all the same way, so the frontend can show an aircraft's
   actual flight history (not just positions polled since the page loaded).
6) Also proxy adsb.fi's and airplanes.live's open data APIs as additional,
   independent data sources covering the same area — both are fully
   anonymous with no daily quota, so they need none of OpenSky's auth/backoff
   machinery, just their own short cache (see cached_radius_source()).
7) Proxy Planespotters' photo lookup (by registration or ICAO24 hex) too —
   not because of CORS (it sends permissive CORS headers), but because it
   rejects requests without a descriptive User-Agent containing contact info,
   and browsers don't allow JS to set that header at all.
8) Also proxy airport-data.com's photo lookup as a second photo source: the
   frontend's gallery uses it to top up the remaining slots whenever
   Planespotters didn't return enough photos to fill the gallery on its own.
"""
import json
import os
import re
import time
from urllib.parse import quote

import requests
from flask import Flask, jsonify, request, send_from_directory

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__, static_folder="static", static_url_path="")

OPENSKY_URL = "https://opensky-network.org/api/states/all"
TRACKS_URL = "https://opensky-network.org/api/tracks/all"
TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network"
    "/protocol/openid-connect/token"
)

CLIENT_ID = os.environ.get("OPENSKY_CLIENT_ID")
CLIENT_SECRET = os.environ.get("OPENSKY_CLIENT_SECRET")

# Bounding box: Serbia and its immediate neighbors (half the size of the
# original Balkans-wide box, centered on Serbia).
BBOX = {"lamin": 41.5, "lomin": 17.0, "lamax": 46.5, "lomax": 25.0}

# Never hit OpenSky more often than every MIN_INTERVAL seconds, no matter how
# many tabs/clients poll our /api/states — keeps both anonymous and
# authenticated access economical.
MIN_INTERVAL = 10
_cache = {"data": None, "ts": 0.0}
_token = {"value": None, "expires_at": 0.0}

# Per-aircraft cache for /api/track/<icao24>. OpenSky's /tracks/* endpoint has
# its own, far stingier credit bucket than /states/* (one charge per aircraft
# per fetch, vs. one shared charge for the whole map), so the track quota drains
# much faster. A generous TTL means repeatedly opening the same aircraft costs
# no extra quota — a track's history barely changes over a few minutes.
TRACK_MIN_INTERVAL = 300
_track_cache = {}  # icao24 -> {"data": ..., "ts": ...}

# The track cache is also persisted to disk so a server restart (including
# Flask's debug auto-reload on every file save) doesn't wipe it and force the
# stingy /tracks/* bucket to be re-spent from scratch. Timestamps are absolute
# wall-clock seconds, so TTL still holds across restarts. Entries older than
# TRACK_CACHE_MAX_AGE are dropped on load to bound the file's growth.
TRACK_CACHE_FILE = os.environ.get("TRACK_CACHE_FILE", ".track_cache.json")
TRACK_CACHE_MAX_AGE = 86400  # 24h


def _load_track_cache():
    """Best-effort: populate _track_cache from disk, skipping entries older than
    TRACK_CACHE_MAX_AGE. A missing or corrupt file is ignored — the cache is a
    quota optimization, not a source of truth."""
    try:
        with open(TRACK_CACHE_FILE, "r") as f:
            stored = json.load(f)
    except (OSError, ValueError):
        return
    if not isinstance(stored, dict):
        return
    cutoff = time.time() - TRACK_CACHE_MAX_AGE
    for icao24, entry in stored.items():
        if isinstance(entry, dict) and entry.get("ts", 0) >= cutoff:
            _track_cache[icao24] = entry


def _save_track_cache():
    """Best-effort atomic write of the whole cache. Track fetches are infrequent
    (per user click, throttled by TRACK_MIN_INTERVAL), so rewriting the file each
    time is cheap. Write errors are ignored for the same reason as above."""
    tmp = TRACK_CACHE_FILE + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(_track_cache, f)
        os.replace(tmp, TRACK_CACHE_FILE)
    except OSError:
        pass


_load_track_cache()

# adsb.fi (https://github.com/adsbfi/opendata) and airplanes.live
# (https://airplanes.live/api-guide/): both open, anonymous, no daily quota,
# but rate-limited to 1 req/s — our own MIN_INTERVAL-style cache below keeps
# us well under that regardless. Neither has a bounding-box query, only
# lat/lon/radius (nautical miles, max 250 for both), so each *_CENTER
# approximates the same Serbia-focused area as BBOX above. Both return the
# same ADSBExchange-compatible JSON shape.
ADSBFI_URL = "https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{dist}"
ADSBFI_CENTER = {"lat": 44.0, "lon": 21.0, "dist": 220}
ADSBFI_MIN_INTERVAL = 10
_adsbfi_cache = {"data": None, "ts": 0.0}

AIRPLANESLIVE_URL = "https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}"
AIRPLANESLIVE_CENTER = {"lat": 44.0, "lon": 21.0, "radius": 220}
AIRPLANESLIVE_MIN_INTERVAL = 10
_airplaneslive_cache = {"data": None, "ts": 0.0}

# adsb.lol (https://api.adsb.lol/docs) and adsb.one (https://api.adsb.one):
# two more independent instances of the same aggregator family as adsb.fi —
# same open, anonymous, no-quota access and the same ADSBExchange-compatible
# JSON shape, so they reuse cached_radius_source() and the frontend's shared
# parseAdsbExchangeAircraft() exactly like adsb.fi/airplanes.live. Both cap the
# radius at 250 nm. NOTE: as of 2026-07-17 api.adsb.one sits behind a Cloudflare
# WAF that 403s server-side requests, so its proxy will return an empty list
# until that's lifted; the pipeline tolerates a dataless source by design.
ADSBLOL_URL = "https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{dist}"
ADSBLOL_CENTER = {"lat": 44.0, "lon": 21.0, "dist": 220}
ADSBLOL_MIN_INTERVAL = 10
_adsblol_cache = {"data": None, "ts": 0.0}

ADSBONE_URL = "https://api.adsb.one/v2/point/{lat}/{lon}/{radius}"
ADSBONE_CENTER = {"lat": 44.0, "lon": 21.0, "radius": 220}
ADSBONE_MIN_INTERVAL = 10
_adsbone_cache = {"data": None, "ts": 0.0}

# Planespotters (https://www.planespotters.net/photo/api): free, no key, but
# requires a descriptive User-Agent with contact info or it 403s — override
# via .env if you want your own contact reference in it (see .env.example).
PLANESPOTTERS_BASE = "https://api.planespotters.net/pub/photos"
PLANESPOTTERS_USER_AGENT = os.environ.get(
    "PLANESPOTTERS_USER_AGENT",
    "ADS-B-Playground/1.0 (+https://github.com/adsb-playground)",
)
# Aircraft photos don't change, so cache indefinitely for the life of the
# process rather than on a time interval like the live-data endpoints above.
_photo_cache = {}  # "reg:<REGISTRATION>" or "hex:<icao24>" -> list of photo dicts

# airport-data.com (https://airport-data.com/api/doc/): free, no key, used to
# top up the gallery with however many extra photos it has beyond what
# Planespotters returned. Note: the "www" subdomain's TLS cert doesn't cover
# "www.airport-data.com", only the bare domain — always request the bare
# domain, not www.
AIRPORTDATA_BASE = "https://airport-data.com/api/ac_thumb.json"
# `ac_thumb.json`'s own "image" field is always a small ~200px thumbnail
# (.../thumbnails/XXX/YYY/<id>.jpg) — airport-data.com separately serves a
# full-size (1200x800, watermarked) version of the same photo at this path,
# keyed by the same numeric id. There's no documented way to get this URL
# directly from the API response, so we extract the id from the thumbnail
# (or link) URL and reconstruct it; the frontend falls back to the plain
# thumbnail client-side if this guessed URL 404s (not every id resolves).
AIRPORTDATA_FULLSIZE_BASE = "https://image.airport-data.com/aircraft/{photo_id}.jpg"
_AIRPORTDATA_ID_RE = re.compile(r"(\d+)\.jpg(?:\?.*)?$")
_airportdata_cache = {}  # "reg:<REGISTRATION>" or "hex:<icao24>" -> list of photo dicts


def _airportdata_fullsize_url(raw_photo):
    for field in ("image", "link"):
        value = raw_photo.get(field)
        if not value:
            continue
        match = _AIRPORTDATA_ID_RE.search(value)
        if match:
            return AIRPORTDATA_FULLSIZE_BASE.format(photo_id=match.group(1))
    return None


def get_access_token():
    """Returns a bearer token for authenticated access, or None if no client
    is configured (in which case we hit OpenSky anonymously)."""
    if not (CLIENT_ID and CLIENT_SECRET):
        return None

    now = time.time()
    if _token["value"] and now < _token["expires_at"] - 30:
        return _token["value"]

    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        },
        timeout=10,
    )
    resp.raise_for_status()
    payload = resp.json()
    _token["value"] = payload["access_token"]
    _token["expires_at"] = now + payload.get("expires_in", 1800)
    return _token["value"]


def fetch_opensky(url, params):
    token = get_access_token()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    resp = requests.get(url, params=params, headers=headers, timeout=10)

    if resp.status_code == 401 and token:
        # Token expired earlier than expected — drop it and retry once.
        _token["value"] = None
        token = get_access_token()
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        resp = requests.get(url, params=params, headers=headers, timeout=10)

    return resp


def fetch_states():
    # extended=1 is required for OpenSky to include the "category" field at
    # all (confirmed empirically: without it, /states/all returns 17-element
    # state vectors, never 18 — category isn't merely null, it's absent).
    return fetch_opensky(OPENSKY_URL, {**BBOX, "extended": 1})


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/states")
def api_states():
    now = time.time()

    if _cache["data"] is not None and now - _cache["ts"] < MIN_INTERVAL:
        return jsonify(_cache["data"])

    try:
        resp = fetch_states()

        if resp.status_code == 429:
            # Rate limit hit — serve the last known cache (if any), flagged as
            # stale. Forward OpenSky's retry-after window (seconds until the
            # daily quota resets) so the frontend can show when the source will
            # be available again, the same way /api/track does for its bucket.
            retry_after = resp.headers.get("X-Rate-Limit-Retry-After-Seconds")
            diagnostics = {
                "retry_after_seconds": int(retry_after) if retry_after is not None else None,
            }
            if _cache["data"] is not None:
                stale = dict(_cache["data"])
                stale["stale"] = True
                stale["error"] = "rate_limited"
                stale.update(diagnostics)
                return jsonify(stale)
            return jsonify({"states": [], "error": "rate_limited", **diagnostics}), 429

        resp.raise_for_status()
        payload = resp.json()
        # OpenSky reports the remaining daily quota in a response header —
        # forward it in the payload so the frontend can display a counter.
        remaining = resp.headers.get("X-Rate-Limit-Remaining")
        payload["rate_limit_remaining"] = int(remaining) if remaining is not None else None
        _cache["data"] = payload
        _cache["ts"] = now
        return jsonify(payload)

    except requests.RequestException as exc:
        if _cache["data"] is not None:
            stale = dict(_cache["data"])
            stale["stale"] = True
            stale["error"] = str(exc)
            return jsonify(stale)
        return jsonify({"states": [], "error": str(exc)}), 502


@app.route("/api/track/<icao24>")
def api_track(icao24):
    now = time.time()
    cached = _track_cache.get(icao24)

    if cached and now - cached["ts"] < TRACK_MIN_INTERVAL:
        return jsonify(cached["data"])

    try:
        # time=0 asks OpenSky for the track of the flight currently (or most
        # recently) in progress for this aircraft.
        resp = fetch_opensky(TRACKS_URL, {"icao24": icao24, "time": 0})

        if resp.status_code == 404:
            # No track known for this aircraft right now.
            return jsonify({"path": [], "error": "not_found"}), 404

        if resp.status_code == 429:
            # Keep OpenSky's rate-limit diagnostics visible to the frontend
            # (and to callers of this proxy). A 429 can mean exhausted daily
            # credits or a shorter retry window, and the response headers are
            # the only way to tell those cases apart.
            remaining = resp.headers.get("X-Rate-Limit-Remaining")
            retry_after = resp.headers.get("X-Rate-Limit-Retry-After-Seconds")
            diagnostics = {
                "rate_limit_remaining": int(remaining) if remaining is not None else None,
                "retry_after_seconds": int(retry_after) if retry_after is not None else None,
            }
            if cached:
                stale = dict(cached["data"])
                stale["stale"] = True
                stale["error"] = "rate_limited"
                stale.update(diagnostics)
                return jsonify(stale)
            return jsonify({"path": [], "error": "rate_limited", **diagnostics}), 429

        resp.raise_for_status()
        payload = resp.json()
        _track_cache[icao24] = {"data": payload, "ts": now}
        _save_track_cache()
        return jsonify(payload)

    except requests.RequestException as exc:
        if cached:
            stale = dict(cached["data"])
            stale["stale"] = True
            stale["error"] = str(exc)
            return jsonify(stale)
        return jsonify({"path": [], "error": str(exc)}), 502


def cached_radius_source(url, cache, min_interval):
    """Shared fetch+cache logic for the simple, anonymous, no-quota radius
    sources (adsb.fi, airplanes.live) — no auth, just a short cache and
    stale-on-failure fallback, unlike OpenSky's endpoints above."""
    now = time.time()

    if cache["data"] is not None and now - cache["ts"] < min_interval:
        return jsonify(cache["data"])

    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        payload = resp.json()
        cache["data"] = payload
        cache["ts"] = now
        return jsonify(payload)

    except requests.RequestException as exc:
        if cache["data"] is not None:
            stale = dict(cache["data"])
            stale["stale"] = True
            stale["error"] = str(exc)
            return jsonify(stale)
        return jsonify({"ac": [], "error": str(exc)}), 502


@app.route("/api/adsbfi")
def api_adsbfi():
    return cached_radius_source(ADSBFI_URL.format(**ADSBFI_CENTER), _adsbfi_cache, ADSBFI_MIN_INTERVAL)


@app.route("/api/airplaneslive")
def api_airplaneslive():
    return cached_radius_source(
        AIRPLANESLIVE_URL.format(**AIRPLANESLIVE_CENTER), _airplaneslive_cache, AIRPLANESLIVE_MIN_INTERVAL
    )


@app.route("/api/adsblol")
def api_adsblol():
    return cached_radius_source(ADSBLOL_URL.format(**ADSBLOL_CENTER), _adsblol_cache, ADSBLOL_MIN_INTERVAL)


@app.route("/api/adsbone")
def api_adsbone():
    return cached_radius_source(ADSBONE_URL.format(**ADSBONE_CENTER), _adsbone_cache, ADSBONE_MIN_INTERVAL)


def fetch_planespotters(kind, value):
    cache_key = f"{kind}:{value}"
    if cache_key in _photo_cache:
        return jsonify({"photos": _photo_cache[cache_key]})

    try:
        resp = requests.get(
            f"{PLANESPOTTERS_BASE}/{kind}/{quote(value, safe='')}",
            headers={"User-Agent": PLANESPOTTERS_USER_AGENT},
            timeout=10,
        )
        resp.raise_for_status()
        photos = resp.json().get("photos", [])
        _photo_cache[cache_key] = photos
        return jsonify({"photos": photos})

    except requests.RequestException as exc:
        return jsonify({"photos": [], "error": str(exc)}), 502


@app.route("/api/photo/reg/<registration>")
def api_photo_reg(registration):
    return fetch_planespotters("reg", registration)


@app.route("/api/photo/hex/<icao24>")
def api_photo_hex(icao24):
    return fetch_planespotters("hex", icao24)


def fetch_airportdata(kind, value, count, registration=None):
    """count is how many additional photos the frontend still needs to fill
    the gallery — passed to airport-data.com as `n`, but per their own docs
    ("Max number of results, default is 1") that's a ceiling, not a
    guarantee: e.g. G-STBC with n=5 returns only 2. Callers must use however
    many photos actually come back, not assume len() == count.
    `registration`, when given alongside an ICAO24 hex lookup, is passed as
    an extra `r` param for a more precise match per airport-data.com's docs.
    Cached by aircraft only (not by count), since the photos themselves
    don't change within a session regardless of how many were requested."""
    cache_key = f"{kind}:{value}"
    if cache_key in _airportdata_cache:
        return jsonify({"photos": _airportdata_cache[cache_key]})

    param_name = "r" if kind == "reg" else "m"
    params = {param_name: value, "n": max(1, count)}
    if kind == "hex" and registration:
        params["r"] = registration

    try:
        resp = requests.get(AIRPORTDATA_BASE, params=params, timeout=10)

        if resp.status_code == 404:
            # Their own "no photo for this aircraft" response — a real,
            # stable answer, so it's safe to cache like any other result.
            _airportdata_cache[cache_key] = []
            return jsonify({"photos": []})

        if resp.status_code == 429 or resp.status_code >= 500:
            # Rate-limited or the upstream service is having trouble — treat
            # as "no top-up photos this time" without caching, so a later
            # request (next card open) can retry instead of being stuck
            # empty for the rest of the session.
            return jsonify({"photos": []})

        resp.raise_for_status()
        raw_photos = resp.json().get("data", [])
        # Normalized to the same {thumbnail_large, link, photographer} shape
        # Planespotters uses, plus an extra `fallback_src` (see
        # _airportdata_fullsize_url) so the frontend gallery can treat both
        # sources identically while still knowing how to degrade gracefully
        # if the reconstructed full-size URL turns out not to exist.
        photos = []
        for p in raw_photos:
            thumb = p.get("image")
            if not thumb:
                continue
            fullsize = _airportdata_fullsize_url(p)
            photos.append({
                "thumbnail_large": {"src": fullsize or thumb},
                "fallback_src": thumb if fullsize else None,
                "link": p.get("link"),
                "photographer": p.get("photographer"),
            })
        _airportdata_cache[cache_key] = photos
        return jsonify({"photos": photos})

    except requests.RequestException as exc:
        return jsonify({"photos": [], "error": str(exc)}), 502


@app.route("/api/photo2/reg/<registration>")
def api_photo2_reg(registration):
    count = request.args.get("n", default=1, type=int)
    return fetch_airportdata("reg", registration, count)


@app.route("/api/photo2/hex/<icao24>")
def api_photo2_hex(icao24):
    count = request.args.get("n", default=1, type=int)
    registration = request.args.get("reg") or None
    return fetch_airportdata("hex", icao24, count, registration=registration)


if __name__ == "__main__":
    # Port is configurable (PORT env var) so the test suite can run on a
    # different one — 5000 is macOS's AirPlay Receiver port by default, which
    # can confuse a health-checking test runner even though Flask itself
    # binds fine alongside it.
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)))
