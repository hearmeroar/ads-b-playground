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
"""
import os
import time
from urllib.parse import quote

import requests
from flask import Flask, jsonify, send_from_directory

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

# Per-aircraft cache for /api/track/<icao24>, so repeated clicks on the same
# aircraft within TRACK_MIN_INTERVAL seconds don't spend extra quota.
TRACK_MIN_INTERVAL = 15
_track_cache = {}  # icao24 -> {"data": ..., "ts": ...}

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
    return fetch_opensky(OPENSKY_URL, BBOX)


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
            # Rate limit hit — serve the last known cache (if any), flagged as stale.
            if _cache["data"] is not None:
                stale = dict(_cache["data"])
                stale["stale"] = True
                stale["error"] = "rate_limited"
                return jsonify(stale)
            return jsonify({"states": [], "error": "rate_limited"}), 429

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
            if cached:
                stale = dict(cached["data"])
                stale["stale"] = True
                stale["error"] = "rate_limited"
                return jsonify(stale)
            return jsonify({"path": [], "error": "rate_limited"}), 429

        resp.raise_for_status()
        payload = resp.json()
        _track_cache[icao24] = {"data": payload, "ts": now}
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


if __name__ == "__main__":
    # Port is configurable (PORT env var) so the test suite can run on a
    # different one — 5000 is macOS's AirPlay Receiver port by default, which
    # can confuse a health-checking test runner even though Flask itself
    # binds fine alongside it.
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)))
