import requests

import app
from conftest import make_response


def test_warm_default_source_caches_success(mock_get, monkeypatch):
    monkeypatch.setattr(app, "RAPIDAPI_KEY", "test-key")
    mock_get.return_value = make_response(200, json_data={"states": [], "ac": []})

    app._warm_default_source_caches()

    assert app._cache["data"] is not None
    assert app._adsbfi_cache["data"] is not None
    assert app._adsblol_cache["data"] is not None
    assert app._airplaneslive_cache["data"] is not None
    assert app._aircraftscatter_cache["data"] is not None


def test_warm_default_source_caches_never_raises_on_failure(mock_get, monkeypatch):
    monkeypatch.setattr(app, "RAPIDAPI_KEY", "test-key")
    mock_get.side_effect = requests.ConnectionError("boom")

    # Must not raise — a warm-up failure is silently swallowed, never allowed
    # to affect worker/dev-server startup.
    app._warm_default_source_caches()

    assert app._cache["data"] is None
    assert app._adsbfi_cache["data"] is None
    assert app._adsblol_cache["data"] is None
    assert app._airplaneslive_cache["data"] is None
    assert app._aircraftscatter_cache["data"] is None
