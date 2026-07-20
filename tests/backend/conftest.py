from unittest.mock import MagicMock

import pytest
import requests

import app
import storage


@pytest.fixture
def client():
    app.app.config["TESTING"] = True
    return app.app.test_client()


@pytest.fixture(autouse=True)
def reset_caches(monkeypatch, tmp_path):
    """app.py keeps caches as module-level dicts, so tests must reset them
    before each run or results leak between test cases (and order starts to
    matter, which pytest explicitly doesn't guarantee)."""
    app._cache.clear()
    app._cache.update({"data": None, "ts": 0.0})
    app._token.clear()
    app._token.update({"value": None, "expires_at": 0.0, "retry_at": 0.0})
    app._opensky_outage.clear()
    app._opensky_outage.update({"until": 0.0})
    app._track_cache.clear()
    # Redirect the persistent track cache to a throwaway file so tests never
    # touch (or accumulate into) the repo's real .track_cache.json.
    monkeypatch.setattr(app, "TRACK_CACHE_FILE", str(tmp_path / "track_cache.json"))
    app._adsbfi_cache.clear()
    app._adsbfi_cache.update({"data": None, "ts": 0.0})
    app._airplaneslive_cache.clear()
    app._airplaneslive_cache.update({"data": None, "ts": 0.0})
    app._adsblol_cache.clear()
    app._adsblol_cache.update({"data": None, "ts": 0.0})
    app._adsbone_cache.clear()
    app._adsbone_cache.update({"data": None, "ts": 0.0})
    app._flightaware_cache.clear()
    app._flightaware_cache.update({"data": None, "ts": 0.0})
    app._flightradar24_cache.clear()
    app._flightradar24_cache.update({"data": None, "ts": 0.0})
    app._photo_cache.clear()
    app._airportdata_cache.clear()
    app._adsbdb_cache.clear()
    app._backfill_queue.clear()
    # Durable state (users, collections, identity cache/history) now lives
    # in SQLite (storage.py) instead of module-level dicts/lists backed by
    # JSONL files — point every test at a fresh throwaway database file and
    # make sure no stale thread-local connection from a previous test (or a
    # previous DB_FILE value) survives, then (re)create the schema in it.
    monkeypatch.setattr(storage, "DB_FILE", str(tmp_path / "test.db"))
    storage.reset_connection()
    storage.init_db()
    app._metar_cache.clear()
    app._metar_cache.update({"data": None, "ts": 0.0})
    app._sigmet_cache.clear()
    app._sigmet_cache.update({"data": None, "ts": 0.0})
    yield


@pytest.fixture(autouse=True)
def no_oauth_by_default(monkeypatch):
    """Most tests exercise the anonymous path; test_auth.py opts into OAuth
    explicitly by overriding these within its own test functions."""
    monkeypatch.setattr(app, "CLIENT_ID", None)
    monkeypatch.setattr(app, "CLIENT_SECRET", None)


@pytest.fixture(autouse=True)
def no_google_oauth_by_default(monkeypatch):
    """Most tests exercise the not_configured path for Sign-in-with-Google;
    test_google_auth.py opts into a configured client explicitly within its
    own tests that need the real authorize_redirect/authorize_access_token
    calls mocked."""
    monkeypatch.setattr(app, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(app, "GOOGLE_CLIENT_SECRET", None)


@pytest.fixture(autouse=True)
def no_flightaware_key_by_default(monkeypatch):
    """Most tests exercise the not_configured path; test_flightaware.py opts
    into a configured key explicitly by overriding it within its own tests."""
    monkeypatch.setattr(app, "FLIGHTAWARE_API_KEY", None)


@pytest.fixture
def mock_get(monkeypatch):
    mock = MagicMock()
    monkeypatch.setattr(app.requests, "get", mock)
    return mock


@pytest.fixture
def mock_post(monkeypatch):
    mock = MagicMock()
    monkeypatch.setattr(app.requests, "post", mock)
    return mock


def login_as(client, user_id):
    """Test helper: simulate an already-logged-in session without exercising
    the real Google OAuth redirect/callback dance. Directly sets the same
    session key api_login_google_callback sets on a real login."""
    with client.session_transaction() as sess:
        sess["user_id"] = user_id


def make_response(status_code=200, json_data=None, headers=None):
    """A minimal stand-in for requests.Response, good enough for how app.py
    uses it: .status_code, .headers, .json(), .raise_for_status()."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = headers or {}
    resp.json.return_value = {} if json_data is None else json_data

    def raise_for_status():
        if status_code >= 400:
            raise requests.HTTPError(f"{status_code} error", response=resp)

    resp.raise_for_status.side_effect = raise_for_status
    return resp
