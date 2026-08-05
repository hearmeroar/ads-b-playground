"""Operator-configurable source visibility (config/sources.json,
_load_sources_config(), /api/config's "sources" key). See
.ai/proposals/source-visibility-config-2026-07-22.md for the full design.

conftest.py's reset_caches fixture redirects SOURCES_FILE (and resets
SOURCES_CONFIG directly, since it's computed once at import time) to a
known-default throwaway file, so these tests never touch the repo's real
config/sources.json.
"""

import json

import app


DEFAULT_SOURCES = {
    "opensky": {"visible": True, "enabled_by_default": True},
    "adsbfi": {"visible": True, "enabled_by_default": True},
    "adsblol": {"visible": True, "enabled_by_default": True},
    "adsbone": {"visible": False, "enabled_by_default": False},
    "airplaneslive": {"visible": True, "enabled_by_default": True},
    "aircraftscatter": {"visible": True, "enabled_by_default": True},
    "flightaware": {"visible": True, "enabled_by_default": False},
    "flightradar24": {"visible": True, "enabled_by_default": False},
    "ogn": {"visible": True, "enabled_by_default": False},
}


def test_load_sources_config_returns_default_when_file_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(app, "SOURCES_FILE", str(tmp_path / "does-not-exist.json"))
    assert app._load_sources_config() == DEFAULT_SOURCES


def test_load_sources_config_returns_default_when_file_malformed(monkeypatch, tmp_path):
    bad_file = tmp_path / "bad.json"
    bad_file.write_text("not valid json {{{")
    monkeypatch.setattr(app, "SOURCES_FILE", str(bad_file))
    assert app._load_sources_config() == DEFAULT_SOURCES


def test_load_sources_config_applies_operator_overrides(monkeypatch, tmp_path):
    custom_file = tmp_path / "sources.json"
    overridden = dict(DEFAULT_SOURCES)
    overridden["adsbone"] = {"visible": True, "enabled_by_default": True}
    overridden["opensky"] = {"visible": True, "enabled_by_default": False}
    custom_file.write_text(json.dumps(overridden))
    monkeypatch.setattr(app, "SOURCES_FILE", str(custom_file))

    loaded = app._load_sources_config()
    assert loaded["adsbone"] == {"visible": True, "enabled_by_default": True}
    assert loaded["opensky"] == {"visible": True, "enabled_by_default": False}


def test_api_config_includes_sources_key(client):
    resp = client.get("/api/config")
    body = resp.get_json()
    assert body["sources"] == DEFAULT_SOURCES
