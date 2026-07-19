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
9) Also proxy adsbdb.com (https://api.adsbdb.com) — a combined aircraft +
   flightroute lookup, used lazily on marker select (like Planespotters/
   airport-data.com and /api/identity) to fill Registered Owner, and to
   supply a flight's origin/destination airports + operating airline when
   FlightAware isn't enabled or didn't match. See CLAUDE.md for the full
   priority chain (live feed > adsbdb > locally-computed enrichment) and
   why adsbdb's other routes (airline lookup, stats, mode-s/n-number
   conversion, and its PATCH routes — those require adsbdb's own operator
   credentials, not something a consumer of their API can use) aren't
   proxied here.
"""
import json
import os
import re
import threading
import time
import uuid
from collections import deque
from urllib.parse import quote

import requests
from authlib.integrations.flask_client import OAuth
from flask import Flask, jsonify, redirect, request, send_from_directory, session, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

from enrichment.aircraft_enrichment import enrich_identity

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__, static_folder="static", static_url_path="")

# Signed session cookie key, needed for Sign-in-with-Google below (Flask's
# `session` is itsdangerous-signed, not server-side, so it needs a secret).
# Falling back to a random key means every restart (including Flask debug's
# reloader re-exec on each file save — see _should_start_background_thread()
# further down for the same restart-vs-reloader distinction) invalidates all
# existing sessions; set SECRET_KEY in .env for logins to survive restarts.
app.secret_key = os.environ.get("SECRET_KEY") or os.urandom(32)

# ProxyFix for Fly.io (and other reverse proxies): read X-Forwarded-Proto
# and X-Forwarded-Host headers so Flask knows the real HTTPS scheme and
# hostname, not what the proxy sees. This fixes OAuth redirect_uri_mismatch
# errors where Flask was generating http:// instead of https://.
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# --- Google OAuth (Sign in with Google) ---
# The one new external-auth dependency in this codebase: hand-rolling
# OAuth2's authorization-code exchange and ID-token verification would be a
# real security risk for no benefit over a well-audited library. Registered
# lazily-configured the same way OpenSky's OAuth2 client-credentials flow
# already degrades to anonymous when unset (see CLIENT_ID/CLIENT_SECRET
# below) — GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are optional; without them
# /api/login/google just reports "not_configured" instead of crashing.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")

oauth = OAuth(app)
oauth.register(
    name="google",
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)

# Users store: one JSONL line per user, keyed by Google's `sub` (a stable
# unique id — unlike email, which a user can change on their Google
# account). No password is ever stored; Google handles the actual
# credential check. Same load/save idiom as _identity_cache below (atomic
# tmp-file + os.replace, best-effort on a missing/corrupt file).
_users = {}  # sub -> {"sub":, "email":, "name":, "picture":, "created_ts":}
USERS_FILE = os.environ.get("USERS_FILE", ".users.jsonl")


def _load_users():
    try:
        with open(USERS_FILE, "r") as f:
            lines = f.readlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        sub = entry.get("sub")
        if sub:
            _users[sub] = entry


def _save_users():
    tmp = USERS_FILE + ".tmp"
    try:
        with open(tmp, "w") as f:
            for entry in _users.values():
                f.write(json.dumps(entry) + "\n")
        os.replace(tmp, USERS_FILE)
    except OSError:
        pass


_load_users()


def _current_user_id():
    return session.get("user_id")


@app.route("/api/login/google")
def api_login_google():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return jsonify({"error": "not_configured"}), 503
    redirect_uri = url_for("api_login_google_callback", _external=True)
    return oauth.google.authorize_redirect(redirect_uri)


@app.route("/api/login/google/callback")
def api_login_google_callback():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return jsonify({"error": "not_configured"}), 503
    token = oauth.google.authorize_access_token()
    userinfo = token.get("userinfo") or {}
    sub = userinfo.get("sub")
    if not sub:
        return jsonify({"error": "google_auth_failed"}), 502
    existing = _users.get(sub, {})
    _users[sub] = {
        "sub": sub,
        "email": userinfo.get("email"),
        "name": userinfo.get("name"),
        "picture": userinfo.get("picture"),
        "created_ts": existing.get("created_ts", time.time()),
    }
    _save_users()
    session["user_id"] = sub
    return redirect("/")


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@app.route("/api/me")
def api_me():
    user = _users.get(_current_user_id())
    return jsonify({"user": user})

OPENSKY_URL = "https://opensky-network.org/api/states/all"
TRACKS_URL = "https://opensky-network.org/api/tracks/all"
TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network"
    "/protocol/openid-connect/token"
)

CLIENT_ID = os.environ.get("OPENSKY_CLIENT_ID")
CLIENT_SECRET = os.environ.get("OPENSKY_CLIENT_SECRET")

# Single source of truth for the observation area: roughly the center of
# Serbia. BBOX (OpenSky's bounding-box query) and every RADIUS_SOURCES
# entry's "center" (lat/lon/radius query, see below) are both derived from
# this one point instead of five independently-maintained constants.
# AREA_ZOOM is the initial Leaflet zoom level that frames this area — served
# via /api/config so the frontend's map.setView() call has one backend-owned
# value to match against instead of a constant it must keep in sync by hand.
AREA_CENTER = {"lat": 44.0, "lon": 21.0}
AREA_ZOOM = 8

# Bounding box: Serbia and its immediate neighbors (half the size of the
# original Balkans-wide box, centered on AREA_CENTER). Half-height/width are
# in degrees latitude/longitude, not distance — deliberately kept as the
# original hand-picked box shape rather than derived from AREA_RADIUS_NM
# below, since a lat/lon box and a radius are different shapes and neither
# converts exactly into the other.
BBOX_HALF_HEIGHT_DEG = 2.5
BBOX_HALF_WIDTH_DEG = 4.0
BBOX = {
    "lamin": AREA_CENTER["lat"] - BBOX_HALF_HEIGHT_DEG,
    "lamax": AREA_CENTER["lat"] + BBOX_HALF_HEIGHT_DEG,
    "lomin": AREA_CENTER["lon"] - BBOX_HALF_WIDTH_DEG,
    "lomax": AREA_CENTER["lon"] + BBOX_HALF_WIDTH_DEG,
}

# Shared by every RADIUS_SOURCES entry below: none of the four has a
# bounding-box query, only lat/lon/radius (nautical miles, max 250 for all
# four), so each approximates the same area as BBOX from one shared radius.
AREA_RADIUS_NM = 220

# Never hit OpenSky more often than every MIN_INTERVAL seconds, no matter how
# many tabs/clients poll our /api/states — keeps both anonymous and
# authenticated access economical.
MIN_INTERVAL = 10
_cache = {"data": None, "ts": 0.0}
_token = {"value": None, "expires_at": 0.0, "retry_at": 0.0}

# If the OAuth2 token endpoint is unreachable (observed in production:
# auth.opensky-network.org connect-timing-out from some hosting networks
# while opensky-network.org itself stays reachable), don't retry it on every
# single request — each attempt costs a full connect-timeout (10s) and would
# otherwise stall every poll. Back off for this long before trying again.
TOKEN_RETRY_COOLDOWN = 60

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
    time is cheap. Entries older than TRACK_CACHE_MAX_AGE are dropped before
    writing to bound the file's growth across long-running processes.
    Write errors are ignored."""
    tmp = TRACK_CACHE_FILE + ".tmp"
    try:
        # Prune entries older than TRACK_CACHE_MAX_AGE (same cutoff as _load_track_cache)
        cutoff = time.time() - TRACK_CACHE_MAX_AGE
        pruned = {k: v for k, v in _track_cache.items() if v.get("ts", 0) >= cutoff}
        with open(tmp, "w") as f:
            json.dump(pruned, f)
        os.replace(tmp, TRACK_CACHE_FILE)
    except OSError:
        pass


_load_track_cache()

# The four simple radius sources — adsb.fi (https://github.com/adsbfi/opendata),
# airplanes.live (https://airplanes.live/api-guide/), adsb.lol
# (https://api.adsb.lol/docs) and adsb.one (https://api.adsb.one) — are all
# open, anonymous, no-daily-quota aggregators (rate-limited to 1 req/s, but
# our own MIN_INTERVAL-style cache keeps us well under that regardless) that
# return the same ADSBExchange-compatible JSON shape, so they share one
# table instead of four repeated URL/CENTER/MIN_INTERVAL/cache groups. None
# has a bounding-box query, only lat/lon/radius (nautical miles, max 250 for
# all four), so each "center" approximates the same Serbia-focused area as
# BBOX above. NOTE: as of 2026-07-17 api.adsb.one sits behind a Cloudflare
# WAF that 403s server-side requests, so its proxy will return an empty list
# until that's lifted; the pipeline tolerates a dataless source by design.
# Adding a fifth is one dict entry plus a one-line alias route below.
RADIUS_SOURCES = {
    # "dist_param" is the query field name each API uses for the radius —
    # adsb.fi/adsb.lol call it "dist", adsb.one/airplanes.live call it
    # "radius" — everything else about the four is identical.
    "adsbfi": {
        "url": "https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{dist}",
        "dist_param": "dist",
        "min_interval": 10,
    },
    "airplaneslive": {
        "url": "https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}",
        "dist_param": "radius",
        "min_interval": 10,
    },
    "adsblol": {
        "url": "https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{dist}",
        "dist_param": "dist",
        "min_interval": 10,
    },
    "adsbone": {
        "url": "https://api.adsb.one/v2/point/{lat}/{lon}/{radius}",
        "dist_param": "radius",
        "min_interval": 10,
    },
}
for _cfg in RADIUS_SOURCES.values():
    _cfg["center"] = {"lat": AREA_CENTER["lat"], "lon": AREA_CENTER["lon"], _cfg["dist_param"]: AREA_RADIUS_NM}
    _cfg["cache"] = {"data": None, "ts": 0.0}
del _cfg

# Back-compat module-level aliases: existing tests (and conftest.py's
# reset_caches) reference these cache dicts directly by name. Same dict
# objects as RADIUS_SOURCES[name]["cache"], not copies — mutating one
# through .clear()/.update() is visible through the other.
_adsbfi_cache = RADIUS_SOURCES["adsbfi"]["cache"]
_airplaneslive_cache = RADIUS_SOURCES["airplaneslive"]["cache"]
_adsblol_cache = RADIUS_SOURCES["adsblol"]["cache"]
_adsbone_cache = RADIUS_SOURCES["adsbone"]["cache"]

# FlightAware AeroAPI (https://www.flightaware.com/commercial/aeroapi/):
# unlike the four radius sources above, this is a paid/metered, API-key-
# authenticated API with a flight-centric shape (one object per flight leg,
# not one per transponder) — notably no ICAO24/hex field, only an ICAO
# *callsign* (`ident`), so it cannot participate in the ICAO24-keyed dedup
# chain the other five sources share; it renders as an independent,
# non-deduplicating overlay instead. Polled on the same MIN_INTERVAL as the
# free sources and on by default — a deliberate cost tradeoff.
FLIGHTAWARE_URL = "https://aeroapi.flightaware.com/aeroapi/flights/search"
FLIGHTAWARE_QUERY = '-latlong "{lamin} {lomin} {lamax} {lomax}"'.format(**BBOX)
FLIGHTAWARE_API_KEY = os.environ.get("FLIGHTAWARE_API_KEY")
FLIGHTAWARE_MIN_INTERVAL = 10
_flightaware_cache = {"data": None, "ts": 0.0}

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


# adsbdb.com (https://api.adsbdb.com, docs: github.com/mrjackwills/adsbdb):
# free, no key, no documented rate limit. Combined aircraft+flightroute
# lookup used lazily on marker select — see fetch_adsbdb() below.
ADSBDB_BASE = "https://api.adsbdb.com/v0"
_adsbdb_cache = {}  # "<icao24>:<callsign-or-empty>" -> {"aircraft": ..., "flightroute": ...}

# Persistent aircraft-identity cache: the narrow, justified slice of a
# broader "aircraft identity intelligence layer" idea discussed and
# rejected at full scope (no ground truth registry to validate against, no
# relational query need yet, entrenched existing players in that space).
# What survives: persisting adsbdb's resolved *airframe* fields (as opposed
# to per-flight fields like operator, which come from flightroute and can
# legitimately differ by callsign/lease) across restarts, and logging when
# one of those fields is later seen with a different value — a minimal,
# free-standing changelog rather than a full history/observations graph.
# Same persistence shape as _track_cache/TRACK_CACHE_FILE below, just
# without a TTL: identity facts don't expire the way a flight track does.
_identity_cache = {}  # icao24 -> {"registration":, "manufacturer":, "type":, "registered_owner":, "updated_ts":}
IDENTITY_CACHE_FILE = os.environ.get("IDENTITY_CACHE_FILE", ".aircraft_identity_cache.jsonl")
IDENTITY_HISTORY_FILE = os.environ.get("IDENTITY_HISTORY_FILE", ".identity_history.jsonl")
IDENTITY_TRACKED_FIELDS = ("registration", "manufacturer", "type", "registered_owner")


def _load_identity_cache():
    """Best-effort: populate _identity_cache from disk. One JSON object per
    line (icao24 + its fields), same readable JSONL convention as
    IDENTITY_HISTORY_FILE, rather than one giant single-line blob — easier
    to scan/diff/grep by hand. A missing file, a corrupt line, or a line
    missing "icao24" is skipped rather than failing the whole load — like
    the track cache, this is an optimization/history layer, not a source
    of truth."""
    try:
        with open(IDENTITY_CACHE_FILE, "r") as f:
            lines = f.readlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        icao24 = entry.pop("icao24", None)
        if icao24:
            _identity_cache[icao24] = entry


def _save_identity_cache():
    """Best-effort atomic write of the whole cache, one aircraft per line.
    Identity resolutions are infrequent (per user click, or one every
    IDENTITY_BACKFILL_INTERVAL seconds in the background), so rewriting the
    whole file each time is cheap. Write errors are ignored."""
    tmp = IDENTITY_CACHE_FILE + ".tmp"
    try:
        with open(tmp, "w") as f:
            for icao24, entry in _identity_cache.items():
                f.write(json.dumps({"icao24": icao24, **entry}) + "\n")
        os.replace(tmp, IDENTITY_CACHE_FILE)
    except OSError:
        pass


def _update_identity_cache(icao24, aircraft):
    """Merges a freshly-fetched adsbdb aircraft record into the persistent
    identity cache. A null incoming value never overwrites a previously
    known one (adsbdb sometimes has partial data). A changed non-null value
    is recorded to IDENTITY_HISTORY_FILE before being overwritten — the
    only "history" this layer keeps, deliberately just a flat append-only
    log rather than a full versioned entity graph."""
    existing = _identity_cache.get(icao24, {})
    updated = dict(existing)
    now = time.time()
    for field in IDENTITY_TRACKED_FIELDS:
        new_value = aircraft.get(field)
        if new_value is None:
            continue
        old_value = existing.get(field)
        if old_value is not None and old_value != new_value:
            try:
                with open(IDENTITY_HISTORY_FILE, "a") as f:
                    f.write(json.dumps({
                        "icao24": icao24, "field": field,
                        "old": old_value, "new": new_value, "ts": now,
                    }) + "\n")
            except OSError:
                pass
        updated[field] = new_value
    updated["updated_ts"] = now
    _identity_cache[icao24] = updated
    _save_identity_cache()


_load_identity_cache()


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
    is configured or the token endpoint can't be reached (in which case we
    hit OpenSky anonymously — same degradation as the "unconfigured" case,
    just triggered by a network failure instead of missing credentials)."""
    if not (CLIENT_ID and CLIENT_SECRET):
        return None

    now = time.time()
    if _token["value"] and now < _token["expires_at"] - 30:
        return _token["value"]

    if now < _token["retry_at"]:
        return None

    try:
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
    except requests.RequestException:
        _token["retry_at"] = now + TOKEN_RETRY_COOLDOWN
        return None

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


@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/test")
def test():
    return "<h1>Test works!</h1>"

@app.route("/")
def index():
    print("GET / called", flush=True)
    try:
        with open("static/index.html", "r") as f:
            print("Returning index.html", flush=True)
            return f.read()
    except FileNotFoundError as e:
        print(f"FileNotFoundError: {e}", flush=True)
        return "<h1>Hello from Railway!</h1><p>static/index.html not found</p>"
    except Exception as e:
        print(f"Error: {e}", flush=True)
        return f"<h1>Error</h1><p>{e}</p>"


@app.route("/api/config")
def api_config():
    # Lets the frontend confirm/correct its initial map view against the one
    # backend-owned AREA_CENTER instead of a hardcoded constant it has to
    # keep in sync by hand — see map-init.js. Pure local values, no I/O, so
    # (like /api/identity) this is deliberately uncached.
    return jsonify({"center": AREA_CENTER, "zoom": AREA_ZOOM, "radius_nm": AREA_RADIUS_NM})


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


def cached_radius_source(url, cache, min_interval, headers=None, params=None, empty_payload=None):
    """Shared fetch+cache logic for the simple, anonymous, no-quota radius
    sources (adsb.fi, airplanes.live) — no auth, just a short cache and
    stale-on-failure fallback, unlike OpenSky's endpoints above. Also used
    by FlightAware (paid/metered but same cache+stale pattern)."""
    now = time.time()

    if cache["data"] is not None and now - cache["ts"] < min_interval:
        return jsonify(cache["data"])

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
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
        default_empty = empty_payload if empty_payload is not None else {"ac": []}
        return jsonify(default_empty), 502


def radius_source_response(name):
    cfg = RADIUS_SOURCES[name]
    return cached_radius_source(cfg["url"].format(**cfg["center"]), cfg["cache"], cfg["min_interval"])


@app.route("/api/source/<name>")
def api_radius_source(name):
    if name not in RADIUS_SOURCES:
        return jsonify({"ac": [], "error": "unknown_source"}), 404
    return radius_source_response(name)


# One-line aliases for the routes the frontend/tests already call — kept
# stable rather than migrating callers to /api/source/<name>.
@app.route("/api/adsbfi")
def api_adsbfi():
    return radius_source_response("adsbfi")


@app.route("/api/airplaneslive")
def api_airplaneslive():
    return radius_source_response("airplaneslive")


@app.route("/api/adsblol")
def api_adsblol():
    return radius_source_response("adsblol")


@app.route("/api/adsbone")
def api_adsbone():
    return radius_source_response("adsbone")


@app.route("/api/flightaware")
def api_flightaware():
    if not FLIGHTAWARE_API_KEY:
        return jsonify({"flights": [], "error": "not_configured"})
    return cached_radius_source(
        FLIGHTAWARE_URL, _flightaware_cache, FLIGHTAWARE_MIN_INTERVAL,
        headers={"x-apikey": FLIGHTAWARE_API_KEY},
        params={"query": FLIGHTAWARE_QUERY},
        empty_payload={"flights": []},
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


def _resolve_adsbdb(icao24, callsign):
    """Combined aircraft + flightroute lookup in a single upstream request
    (adsbdb supports a `?callsign=` query param on the aircraft endpoint
    that returns both objects together — no separate /v0/airline/ call is
    needed since flightroute.airline is already nested in that response).
    Cached indefinitely, like Planespotters: an aircraft's identity and a
    given callsign's route are stable facts, not live telemetry that goes
    stale. A network error/5xx is deliberately left uncached so a later
    click can retry; an "unknown aircraft" 404 is cached as an empty result
    since that's a stable answer too.

    Returns a plain (result_dict, status_code) tuple rather than a Flask
    response — this is what lets the background identity-backfill worker
    (a plain thread, no request/app context) call it directly. fetch_adsbdb()
    below is the thin Flask-facing wrapper around this."""
    cache_key = f"{icao24}:{callsign or ''}"
    if cache_key in _adsbdb_cache:
        return _adsbdb_cache[cache_key], 200

    url = f"{ADSBDB_BASE}/aircraft/{quote(icao24, safe='')}"
    params = {"callsign": callsign} if callsign else None

    try:
        resp = requests.get(url, params=params, timeout=10)

        if resp.status_code == 404:
            result = {"aircraft": None, "flightroute": None}
            _adsbdb_cache[cache_key] = result
            return result, 200

        resp.raise_for_status()
        payload = resp.json().get("response", {})
        result = {
            "aircraft": payload.get("aircraft"),
            "flightroute": payload.get("flightroute"),
        }
        _adsbdb_cache[cache_key] = result
        if result["aircraft"]:
            _update_identity_cache(icao24, result["aircraft"])
        return result, 200

    except requests.RequestException as exc:
        return {"aircraft": None, "flightroute": None, "error": str(exc)}, 502


def fetch_adsbdb(icao24, callsign):
    result, status = _resolve_adsbdb(icao24, callsign)
    return jsonify(result), status


@app.route("/api/adsbdb/<icao24>")
def api_adsbdb(icao24):
    callsign = request.args.get("callsign") or None
    return fetch_adsbdb(icao24, callsign)


# --- Background identity backfill ---
# Resolves identity for aircraft this tracker actually sees, without
# waiting for a marker click and without a bulk download from adsbdb (it
# has none — only a per-ICAO24 endpoint). Reuses the OpenSky/radius-source
# caches the frontend's own poll cycle already keeps warm, so this needs no
# new frontend request and no separate "what's visible" bookkeeping.
IDENTITY_BACKFILL_INTERVAL = float(os.environ.get("IDENTITY_BACKFILL_INTERVAL", 5.0))
_backfill_queue = deque()


def _collect_visible_icao24s():
    """Every icao24 currently sitting in the already-warm OpenSky/radius-
    source caches (populated by the frontend's own poll, not fetched here).
    FlightAware's cache is skipped — it's flight-centric, no ICAO24 field
    (see CLAUDE.md's FlightAware section)."""
    visible = set()
    states_data = _cache["data"]
    if states_data and states_data.get("states"):
        for state in states_data["states"]:
            if state and state[0]:
                visible.add(state[0].lower())
    for cfg in RADIUS_SOURCES.values():
        payload = cfg["cache"]["data"]
        if payload and payload.get("ac"):
            for aircraft in payload["ac"]:
                hex_id = aircraft.get("hex")
                if hex_id:
                    visible.add(hex_id.lower())
    return visible


def _identity_backfill_tick():
    """One step of the background worker: resolve at most one not-yet-
    cached aircraft. Refills _backfill_queue from the currently-visible set
    whenever it runs dry, rather than recomputing candidates every tick."""
    if not _backfill_queue:
        candidates = _collect_visible_icao24s() - set(_identity_cache.keys())
        _backfill_queue.extend(sorted(candidates))
    if not _backfill_queue:
        return
    icao24 = _backfill_queue.popleft()
    if icao24 in _identity_cache:
        return  # resolved via a real click since being queued
    _resolve_adsbdb(icao24, None)  # no callsign needed — aircraft-only lookup


def _should_start_background_thread():
    """Flask's debug-mode reloader re-execs the whole process: a "watcher"
    parent (app.debug True, WERKZEUG_RUN_MAIN unset) that only monitors
    files, and a child that actually serves requests (WERKZEUG_RUN_MAIN=
    "true"). Starting the background thread unconditionally would start it
    twice — once uselessly in the watcher. Without the reloader (debug=False,
    e.g. a production WSGI server), there is no watcher process at all, so
    it should just start normally."""
    return not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true"


def _start_identity_backfill_thread():
    if IDENTITY_BACKFILL_INTERVAL <= 0 or not _should_start_background_thread():
        return

    def _loop():
        while True:
            try:
                _identity_backfill_tick()
            except Exception:
                pass  # a transient bug here must never kill the worker
            time.sleep(IDENTITY_BACKFILL_INTERVAL)

    threading.Thread(target=_loop, daemon=True, name="identity-backfill").start()


def _count_identity_history():
    """Line count of IDENTITY_HISTORY_FILE (0 if missing) — cheap enough to
    just re-read on each dev-mode-only stats request rather than keep a
    separately-maintained in-memory counter that could drift from the file."""
    try:
        with open(IDENTITY_HISTORY_FILE, "r") as f:
            return sum(1 for line in f if line.strip())
    except OSError:
        return 0


@app.route("/api/identity/stats")
def api_identity_stats():
    # Dev-mode-only diagnostic for the persistent identity cache/history log
    # (see _identity_cache above) — pure local reads, no I/O worth caching,
    # same rationale as /api/identity/<icao24>'s own uncached status.
    return jsonify({
        "identity_count": len(_identity_cache),
        "history_count": _count_identity_history(),
    })


@app.route("/api/identity/<icao24>")
def api_identity(icao24):
    # Fetched lazily on marker select (static/index.html's
    # loadIdentityEnrichment()), never during the main poll loop — unlike
    # every other route above, this makes zero I/O calls (pure local dict
    # lookups over a few dozen entries), so it's deliberately uncached: the
    # caching machinery elsewhere exists to protect a rate-limited *external*
    # HTTP source, which doesn't apply here.
    result = enrich_identity(
        icao24,
        registration=request.args.get("registration") or None,
        callsign=request.args.get("callsign") or None,
        aircraft_type=request.args.get("aircraft_type") or None,
        known_country=request.args.get("known_country") or None,
        known_operator=request.args.get("known_operator") or None,
        known_manufacture_year=request.args.get("known_manufacture_year", type=int),
    )
    return jsonify(result)


# --- Aircraft collection ("save aircraft you like, browse as cards") ---
# One shared JSONL file (same atomic-write idiom as _identity_cache above),
# filtered by user_id on read rather than split into per-user files — keeps
# the load/save code to one file/one dict, same as the identity cache.
_collections = []  # list of card dicts, see SNAPSHOT_FIELDS below
COLLECTIONS_FILE = os.environ.get("COLLECTIONS_FILE", ".collections.jsonl")

# Single source of truth for which `info` fields a saved card snapshots.
# Deliberately excludes live telemetry (altitude/speed/squawk/...) — those
# are meaningless once the aircraft is long gone, and the backend filters
# the client-sent snapshot to exactly this allowlist before persisting, so
# a client can never smuggle arbitrary extra keys into storage.
SNAPSHOT_FIELDS = (
    "registration", "aircraftType", "manufacturer", "model", "manufactureYear",
    "operator", "operatorCountry", "operatorCountryIso", "originCountry", "countryIso",
    "registeredOwner", "registeredOwnerCountryIso", "categoryDisplay", "callsign",
    "categoryGroup",
)


def _load_collections():
    try:
        with open(COLLECTIONS_FILE, "r") as f:
            lines = f.readlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get("id") and entry.get("user_id"):
            _collections.append(entry)


def _save_collections():
    tmp = COLLECTIONS_FILE + ".tmp"
    try:
        with open(tmp, "w") as f:
            for card in _collections:
                f.write(json.dumps(card) + "\n")
        os.replace(tmp, COLLECTIONS_FILE)
    except OSError:
        pass


_load_collections()


@app.route("/api/collection", methods=["GET"])
def api_collection_list():
    user_id = _current_user_id()
    if not user_id:
        return jsonify({"error": "not_authenticated"}), 401
    cards = [c for c in _collections if c["user_id"] == user_id]
    cards.sort(key=lambda c: c["saved_at"], reverse=True)
    return jsonify({"cards": cards})


@app.route("/api/collection", methods=["POST"])
def api_collection_save():
    user_id = _current_user_id()
    if not user_id:
        return jsonify({"error": "not_authenticated"}), 401
    data = request.get_json(silent=True) or {}
    icao24 = data.get("icao24")
    if not icao24:
        return jsonify({"error": "icao24_required"}), 400
    # "C0" (ADS-B DO-260B: surface vehicle, no category info at all) and any
    # aircraft flagged as a ground vehicle/tower (looksLikeGroundVehicle()'s
    # heuristics on the frontend — a registration/callsign match, like a
    # "TWR" beacon, can flag one with no category code at all) are both
    # rejected server-side too, not just by the frontend hiding the save
    # button entirely — a client-sent field is never trusted alone.
    if data.get("category_code") == "C0" or data.get("is_ground_vehicle"):
        return jsonify({"error": "category_not_collectible"}), 400
    raw_snapshot = data.get("snapshot") or {}
    snapshot = {k: raw_snapshot.get(k) for k in SNAPSHOT_FIELDS if raw_snapshot.get(k) is not None}
    photo_fields = {
        "photo_url": data.get("photo_url"),
        "photo_link": data.get("photo_link"),
        "photo_photographer": data.get("photo_photographer"),
    }
    # One card per icao24 per user: re-saving an already-collected aircraft
    # refreshes its snapshot/photo/timestamp in place rather than appending
    # a duplicate — this is what makes a simple filled/outline toggle icon
    # in the sidebar unambiguous (no "which of N saved copies" question).
    existing = next(
        (c for c in _collections if c["user_id"] == user_id and c["icao24"] == icao24), None
    )
    if existing:
        existing["snapshot"] = snapshot
        existing["saved_at"] = time.time()
        existing.update(photo_fields)
        _save_collections()
        return jsonify(existing), 200
    card = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "icao24": icao24,
        "saved_at": time.time(),
        "snapshot": snapshot,
        **photo_fields,
    }
    _collections.append(card)
    _save_collections()
    return jsonify(card), 201


@app.route("/api/collection/<card_id>", methods=["DELETE"])
def api_collection_delete(card_id):
    user_id = _current_user_id()
    if not user_id:
        return jsonify({"error": "not_authenticated"}), 401
    before = len(_collections)
    _collections[:] = [
        c for c in _collections if not (c["id"] == card_id and c["user_id"] == user_id)
    ]
    if len(_collections) == before:
        return jsonify({"error": "not_found"}), 404
    _save_collections()
    return jsonify({"ok": True})


# --- Aviation weather (aviationweather.gov / NOAA Aviation Weather Center) ---
# Free, no API key, but (unlike RainViewer) sends no CORS header at all
# (confirmed via curl -I -H "Origin: ..."), so — like OpenSky — it needs a
# backend proxy; the browser would otherwise block reading the response.
AVIATIONWEATHER_BASE = "https://aviationweather.gov/api/data"
METAR_MIN_INTERVAL = 300  # station obs update roughly hourly; no need to hit more often
SIGMET_MIN_INTERVAL = 300
_metar_cache = {"data": None, "ts": 0.0}
_sigmet_cache = {"data": None, "ts": 0.0}

# The isigmet (international SIGMET) endpoint ignores bbox/loc query params
# entirely — confirmed live, identical ~144-record global response
# regardless — so filtering to "near our area" has to happen here instead.
# Padded well past BBOX itself since a SIGMET polygon can be large and
# centered outside our exact box while still overlapping it; a coarse
# "does any vertex fall in the padded box" check is good enough for this
# purpose (the polygon is drawn in full on the frontend regardless — this
# only decides whether to include it at all).
SIGMET_FILTER_PADDING_DEG = 10.0


def _sigmet_coord_points(sigmet):
    """Flattens sigmet["coords"] to a flat list of {"lat":, "lon":} dicts.

    Its shape depends on "geom": a single-polygon SIGMET ("AREA") has
    coords as a flat list of point dicts, but a multi-polygon one ("AREAS",
    e.g. two separate boxes describing a "west of this line / east of that
    line" corridor — confirmed against a real FCBB/Brazzaville SIGMET) has
    coords as a list of *rings*, each itself a list of point dicts. A first
    version assumed the flat shape unconditionally and 500'd the very first
    time a real "AREAS" record came through.
    """
    coords = sigmet.get("coords") or []
    if coords and isinstance(coords[0], list):
        return [point for ring in coords for point in ring]
    return coords


def _sigmet_intersects_area(sigmet):
    lamin = BBOX["lamin"] - SIGMET_FILTER_PADDING_DEG
    lamax = BBOX["lamax"] + SIGMET_FILTER_PADDING_DEG
    lomin = BBOX["lomin"] - SIGMET_FILTER_PADDING_DEG
    lomax = BBOX["lomax"] + SIGMET_FILTER_PADDING_DEG
    for coord in _sigmet_coord_points(sigmet):
        lat, lon = coord.get("lat"), coord.get("lon")
        if lat is not None and lon is not None and lamin <= lat <= lamax and lomin <= lon <= lomax:
            return True
    return False


@app.route("/api/metar")
def api_metar():
    now = time.time()
    if _metar_cache["data"] is not None and now - _metar_cache["ts"] < METAR_MIN_INTERVAL:
        return jsonify(_metar_cache["data"])
    bbox = f"{BBOX['lamin']},{BBOX['lomin']},{BBOX['lamax']},{BBOX['lomax']}"
    try:
        resp = requests.get(f"{AVIATIONWEATHER_BASE}/metar", params={"bbox": bbox, "format": "json"}, timeout=10)
        resp.raise_for_status()
        payload = resp.json()
        _metar_cache["data"] = payload
        _metar_cache["ts"] = now
        return jsonify(payload)
    except requests.RequestException:
        if _metar_cache["data"] is not None:
            return jsonify(_metar_cache["data"])
        return jsonify([]), 502


@app.route("/api/sigmet")
def api_sigmet():
    now = time.time()
    if _sigmet_cache["data"] is not None and now - _sigmet_cache["ts"] < SIGMET_MIN_INTERVAL:
        return jsonify(_sigmet_cache["data"])
    try:
        resp = requests.get(f"{AVIATIONWEATHER_BASE}/isigmet", params={"format": "json"}, timeout=10)
        resp.raise_for_status()
        payload = resp.json()
        filtered = [s for s in payload if _sigmet_intersects_area(s)]
        _sigmet_cache["data"] = filtered
        _sigmet_cache["ts"] = now
        return jsonify(filtered)
    except requests.RequestException:
        if _sigmet_cache["data"] is not None:
            return jsonify(_sigmet_cache["data"])
        return jsonify([]), 502


if __name__ == "__main__":
    # app.debug isn't actually set to True until app.run(debug=True) starts
    # executing — _should_start_background_thread() needs to see the value
    # app.run() is about to use, not Flask's pre-run default of False, so
    # it's set explicitly here first (app.run() below just confirms the
    # same value).
    app.debug = True
    _start_identity_backfill_thread()

    # Port is configurable (PORT env var) so the test suite can run on a
    # different one. The default is 5051, not 5000 — 5000 (and often 5001)
    # is permanently occupied on macOS by ControlCenter's AirPlay Receiver,
    # which can't be disabled without giving up AirPlay entirely. 5051 sits
    # next to the Playwright test port (5050) and has no known common
    # claimant (not AirPlay, ASP.NET Core, Synology, or any typical local
    # dev/db default).
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", 5051)))
