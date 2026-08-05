"""Gunicorn server config, auto-discovered from the working directory
(Dockerfile's WORKDIR /app, where `COPY . .` places this file too — no
`-c`/`--config` flag needed on the Dockerfile's CMD). See app.py's
_warm_default_source_caches() for what this actually does and why it's a
one-shot warm-up, not a repeating poller.

post_fork fires once per freshly-forked worker, before that worker starts
serving. The warm-up runs in a background thread rather than blocking
post_fork synchronously: OpenSky's OAuth path alone can take up to ~20s
worst case (two sequential 10s-timeout round trips, see get_access_token()/
fetch_opensky() in app.py), and blocking post_fork for the worst case across
all 5 default sources risks gunicorn's own --timeout (Dockerfile) deciding
an unresponsive-looking worker never came up and recycling it before it
ever serves a request.

Also starts the OGN background thread (app.py's _start_ogn_thread(), see
ogn_source.py) per worker — unlike the cache warm-up above, this isn't an
optimization: /api/ogn has no request/response fetch of its own at all, so
without this connection actually running that route always returns empty.
Each of the Dockerfile's 2 gunicorn workers gets its own independent
APRS-IS connection; OGN's public network has no documented per-client rate
limit this would run afoul of.
"""
import threading


def post_fork(server, worker):
    import app as app_module  # imported inside the hook, not at module
    # scope, so gunicorn's master process (which also reads this file but
    # never forks a worker itself) doesn't trigger app.py's own
    # module-level side effects (SQLite init, track-cache load from disk)
    # redundantly.
    server.log.info("worker %s: starting one-time cache warm-up", worker.pid)
    threading.Thread(
        target=app_module._warm_default_source_caches,
        daemon=True,
        name="cache-warmup",
    ).start()
    server.log.info("worker %s: starting OGN background connection", worker.pid)
    app_module._start_ogn_thread()
