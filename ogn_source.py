"""Open Glider Network (OGN) live source.

Unlike every other data source in app.py, OGN has no plain HTTP GET API to
proxy/cache — see https://wiki.glidernet.org/dev-python for the reference
Python client (the `ogn-client` PyPI package this module uses). OGN's data
travels over the same public APRS-IS network amateur radio uses
(aprs.glidernet.org:14580): a persistent TCP connection, logged in with an
identifying (but unregistered — no signup/API key) callsign-shaped username,
optionally narrowed with a server-side range filter, that then streams
newline-delimited APRS beacon lines forever. There is nothing to
request/response-cache the way cached_radius_source() does for the plain
HTTP sources; instead a single background daemon thread holds one long-lived
connection and keeps an in-memory "most recent beacon per aircraft address"
snapshot, and /api/ogn (app.py) just reads that snapshot.

OGN mostly covers gliders, tow planes, paragliders/hang-gliders, and small
UAVs tracked via FLARM/OGN trackers — a different, largely non-overlapping
population from the transponder-equipped aircraft every other source here
covers. Most beacon addresses are FLARM/OGN-assigned (address_type 2/3), not
real ICAO24 Mode-S addresses (address_type 1) — rendering this as a
deduplicated ICAO24-keyed source alongside OpenSky/adsb.fi/etc. would risk a
FLARM address coincidentally colliding with an unrelated aircraft's real
ICAO24 elsewhere. So, like FlightAware, OGN renders as its own independent,
non-deduplicated overlay rather than joining the ICAO24 dedup chain.
"""
import logging
import os
import threading
import time
import types

from ogn.client import AprsClient
from ogn.client import settings as _ogn_default_settings
from ogn.parser import parse
from ogn.parser.exceptions import AprsParseError

logger = logging.getLogger(__name__)

# APRS-IS wants a callsign-shaped identifier, not a real registered account —
# the same "no signup" posture as every other source in this app. Override
# via OGN_APRS_USER if you want your own identifier in server logs. Found
# live: the server enforces a max length on this (rejects with "# Invalid
# username format" and drops the connection after a delay) — the original
# 11-character default ("ADSBPLYGRND") silently failed login this way for a
# long time before being caught, since a failed *login* doesn't fail the
# underlying TCP connect() itself. Kept to 9 characters, the conventional
# APRS callsign length limit.
OGN_APRS_USER = os.environ.get("OGN_APRS_USER", "ADSBPLGRD")

# ogn-client's own default APRS_KEEPALIVE_TIME (240s — how often it sends a
# "#keepalive" line to the *server*) is tuned for a network path that can
# hold a mostly-idle TCP connection open that long. Found live, not
# theoretical: on at least one real network path this app was tested from,
# a connection that received no traffic for ~30s was silently closed
# ("Read returns zero length string" — a clean FIN, consistent with an
# intermediate NAT/firewall's idle-connection timeout, not the OGN server
# itself). A ~400km range filter can easily go quieter than that between
# beacons, and APRS-IS servers don't reliably send their own status lines
# often enough to substitute. Sending our own keepalive far more often
# (every 15s) keeps the connection's idle timer from ever accumulating
# enough idle time to trip a middlebox's timeout — harmless overhead on a
# network path that didn't need it, a real fix on one that does.
_OGN_KEEPALIVE_SECONDS = 15
_ogn_settings = types.SimpleNamespace(
    APRS_SERVER_HOST=_ogn_default_settings.APRS_SERVER_HOST,
    APRS_SERVER_PORT_FULL_FEED=_ogn_default_settings.APRS_SERVER_PORT_FULL_FEED,
    APRS_SERVER_PORT_CLIENT_DEFINED_FILTERS=_ogn_default_settings.APRS_SERVER_PORT_CLIENT_DEFINED_FILTERS,
    APRS_APP_NAME=_ogn_default_settings.APRS_APP_NAME,
    APRS_APP_VER=_ogn_default_settings.APRS_APP_VER,
    APRS_KEEPALIVE_TIME=_OGN_KEEPALIVE_SECONDS,
)

# A beacon this stale almost certainly means the aircraft landed/lost signal/
# left the filtered range — dropped from the snapshot rather than shown as a
# marker frozen at its last reported position indefinitely.
STALE_SECONDS = 300

# aprs_type values worth keeping — a beacon carries position, a status message
# (ground station health) or a bare comment do not and are skipped.
_POSITION_APRS_TYPES = ("position", "position_weather")

_lock = threading.Lock()
_beacons = {}  # address -> {..parsed fields.., "_received_ts": float}

_current_filter = None  # "r/lat/lon/radius_km" APRS-IS range filter string
_client_holder = {"client": None}

_started = False
_start_lock = threading.Lock()


def _build_filter(lat, lon, radius_km):
    return "r/{:.4f}/{:.4f}/{:.0f}".format(lat, lon, max(1, radius_km))


def set_range(lat, lon, radius_km):
    """Move the APRS-IS range filter to a new center — called from
    app.py's _apply_zone() alongside every other location-scoped source, so
    a zone change (airport search) narrows OGN's feed too, not just the six
    HTTP sources. APRS-IS filters are set at login time by this client, not
    changeable on an already-open connection, so this disconnects the
    current one (if any); _worker()'s outer loop reconnects with the new
    filter. A client that hasn't connected yet (e.g. thread not started)
    just picks the new filter up on its first connect."""
    global _current_filter
    _current_filter = _build_filter(lat, lon, radius_km)
    client = _client_holder.get("client")
    if client is not None:
        try:
            client.disconnect()
        except Exception:
            pass  # best-effort — _worker()'s own reconnect loop recovers either way


def clear():
    """Drop every currently-held beacon — called alongside every other
    location-scoped cache clear in _apply_zone() so a zone change doesn't
    keep showing the old region's gliders until they individually age out."""
    with _lock:
        _beacons.clear()


def _process_line(raw_line):
    if not raw_line or raw_line.startswith("#"):
        return  # server comment/keepalive/login-ack line, not an aircraft beacon
    try:
        beacon = parse(raw_line)
    except AprsParseError:
        return
    except Exception:
        # A third-party public network's raw text is not something a parser
        # bug here should ever be allowed to kill the whole connection over.
        logger.debug("OGN: failed to parse line: %r", raw_line, exc_info=True)
        return
    if beacon.get("aprs_type") not in _POSITION_APRS_TYPES:
        return
    address = beacon.get("address") or beacon.get("name")
    lat = beacon.get("latitude")
    lon = beacon.get("longitude")
    if address is None or lat is None or lon is None:
        return
    with _lock:
        _beacons[address] = {
            "address": address,
            "name": beacon.get("name"),
            "address_type": beacon.get("address_type"),
            "aircraft_type": beacon.get("aircraft_type"),
            "beacon_type": beacon.get("beacon_type"),
            "latitude": lat,
            "longitude": lon,
            "altitude": beacon.get("altitude"),
            "track": beacon.get("track"),
            "ground_speed": beacon.get("ground_speed"),
            "climb_rate": beacon.get("climb_rate"),
            "turn_rate": beacon.get("turn_rate"),
            "receiver_name": beacon.get("receiver_name"),
            "_received_ts": time.time(),
        }


def snapshot():
    """Current beacons, pruned of anything older than STALE_SECONDS. Called
    directly from /api/ogn — there's no request/response fetch to cache
    here, the background thread is what keeps this warm."""
    now = time.time()
    with _lock:
        stale = [addr for addr, b in _beacons.items() if now - b["_received_ts"] > STALE_SECONDS]
        for addr in stale:
            del _beacons[addr]
        return [{k: v for k, v in b.items() if k != "_received_ts"} for b in _beacons.values()]


# Two real, only-found-by-testing-live problems with using AprsClient.run()
# as-is, both stemming from the same root cause — its keepalive send only
# ever happens *between* readline() calls, never *during* one:
#
# 1. connect()'s socket_timeout also governs every later readline() (same
#    socket) — the library's 5s default is fine for the TCP handshake but
#    far too aggressive as a *read* timeout for a range-filtered regional
#    feed, which (unlike the unfiltered global firehose) can legitimately
#    go quiet for more than 5s between lines. Every connection was actually
#    succeeding (confirmed via AprsClient's own "Connect to OGN ..." log
#    line, only ever emitted *after* a successful connect) and then
#    immediately hitting a read timeout on the very next readline(),
#    misleadingly logged by the library as "Connect error: timed out" —
#    forever preventing any beacon from being read despite the network path
#    itself being fine the whole time.
# 2. Raising the read timeout to ride out a quiet spell (tried first)
#    surfaced a second, real issue: on at least one network path this app
#    was tested from, an idle connection got silently closed after ~30s
#    ("Read returns zero length string" — a clean FIN, consistent with an
#    intermediate NAT/firewall's idle-connection timeout, not the OGN
#    server itself). AprsClient.run()'s own keepalive send is only checked
#    right before each readline() call — it cannot fire *while* readline()
#    is still blocked waiting for a line, so a long quiet spell means no
#    keepalive goes out either, no matter how short APRS_KEEPALIVE_TIME is
#    configured.
#
# Fix: don't use client.run() at all. IDLE_READ_TIMEOUT keeps each
# individual readline() short enough that the loop regains control often —
# a plain TimeoutError here is routine (nothing arrived yet), not a
# failure, so it's caught and the loop just checks whether a keepalive is
# due and tries reading again, rather than tearing the connection down the
# way AprsClient.run() would. This is what actually keeps a quiet,
# range-filtered connection alive indefinitely instead of needing either
# value tuned to guess right.
CONNECT_SOCKET_TIMEOUT = 10
IDLE_READ_TIMEOUT = 10


def _read_loop(client, aprs_filter):
    """Minimal reimplementation of AprsClient.run()'s inner loop — see the
    comment above for why the library's own version doesn't work for this
    source. Returns (letting _worker()'s outer loop reconnect) on a real
    connection error, a clean peer close, or the range filter having moved
    out from under this connection; a routine idle timeout is not a return
    condition.

    Reads raw bytes via client.sock.recv() directly, not client.sock_file
    (the buffered file-like wrapper socket.makefile() returns) — found live
    that once a read on that wrapper times out, CPython's SocketIO raises a
    plain OSError("cannot read from timed out object") on every subsequent
    call, not a distinguishable TimeoutError/socket.timeout the way a raw
    socket read does, making a routine idle timeout indistinguishable from
    a real connection failure. A raw socket's own recv() doesn't have this
    problem — it raises a clean, catchable TimeoutError every time.

    aprs_filter is the filter this specific client logged in with —
    compared against the module-level _current_filter (updated by
    set_range()) on every idle-timeout tick, not relied on solely via
    set_range()'s own client.disconnect() call. Found live: a zone change
    (airport search) landing while this client hadn't finished its own
    connect() yet (self.sock not assigned) made that disconnect() call
    silently no-op (best-effort, catches everything) — the stale connection
    then kept reading the *old* area's traffic indefinitely instead of
    picking up the new one, since nothing else was watching for the filter
    having moved. This check bounds that staleness window to
    IDLE_READ_TIMEOUT instead of leaving it open-ended."""
    keepalive_at = time.time()
    buf = b""
    while True:
        if _current_filter != aprs_filter:
            logger.debug("OGN: range filter changed, reconnecting")
            return
        if time.time() - keepalive_at > _OGN_KEEPALIVE_SECONDS:
            try:
                client.sock.send(b"#keepalive\n")
            except OSError as e:
                logger.debug("OGN: keepalive send failed: %r", e)
                return  # a failed send means the connection is already gone
            keepalive_at = time.time()
        if b"\n" not in buf:
            try:
                chunk = client.sock.recv(4096)
            except TimeoutError:
                continue  # routine — nothing arrived within IDLE_READ_TIMEOUT, try again
            except OSError as e:
                logger.debug("OGN: read error: %r", e)
                return  # a real socket/connection error — let the caller reconnect
            if not chunk:
                logger.debug("OGN: peer closed connection (EOF)")
                return  # peer closed the connection (EOF)
            buf += chunk
            continue
        raw, _, buf = buf.partition(b"\n")
        raw = raw.strip()
        if raw:
            _process_line(raw.decode(errors="replace"))


def _worker():
    while True:
        aprs_filter = _current_filter or ""
        client = AprsClient(aprs_user=OGN_APRS_USER, aprs_filter=aprs_filter, settings=_ogn_settings)
        _client_holder["client"] = client
        try:
            client.connect(retries=5, wait_period=15, socket_timeout=CONNECT_SOCKET_TIMEOUT)
        except Exception:
            logger.exception("OGN: connect() raised")
            time.sleep(30)
            continue
        if getattr(client, "_kill", False):
            # connect() gave up after its retries — back off before trying
            # a whole new client rather than spinning immediately.
            time.sleep(30)
            continue
        try:
            client.sock.settimeout(IDLE_READ_TIMEOUT)
        except Exception:
            pass  # best-effort — a failure here just means the connect-phase timeout stays in effect
        try:
            _read_loop(client, aprs_filter)  # blocks until the connection needs reconnecting
        except Exception:
            logger.exception("OGN: _read_loop() crashed")
        time.sleep(2)  # avoid a tight reconnect loop if _read_loop() returns immediately


def start_background_thread():
    """Idempotent — safe to call more than once (app.py's dev-mode entry
    point and gunicorn.conf.py's post_fork both call this); only the first
    call actually starts a thread."""
    global _started
    with _start_lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_worker, daemon=True, name="ogn-aprs").start()
