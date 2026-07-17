from unittest.mock import MagicMock

import pytest
import requests

import app


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
    app._token.update({"value": None, "expires_at": 0.0})
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
    app._photo_cache.clear()
    app._airportdata_cache.clear()
    yield


@pytest.fixture(autouse=True)
def no_oauth_by_default(monkeypatch):
    """Most tests exercise the anonymous path; test_auth.py opts into OAuth
    explicitly by overriding these within its own test functions."""
    monkeypatch.setattr(app, "CLIENT_ID", None)
    monkeypatch.setattr(app, "CLIENT_SECRET", None)


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
