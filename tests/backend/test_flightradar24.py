from types import SimpleNamespace

import pytest

import app
from FlightRadarAPI.errors import CloudflareError


def fake_flight(**overrides):
    """A stand-in for FlightRadarAPI's Flight object, good enough for how
    app.py uses it: _serialize_fr24_flight() only ever does getattr() over
    FLIGHTRADAR24_FIELDS, so a plain attribute bag is sufficient."""
    fields = {
        "id": "40bff2eb", "icao_24bit": "407739", "latitude": 43.936,
        "longitude": 17.092, "heading": 312, "altitude": 36000,
        "ground_speed": 424, "squawk": "", "aircraft_code": "B38M",
        "registration": "G-TUMH", "time": 1784502386,
        "origin_airport_iata": "HRG", "destination_airport_iata": "BRS",
        "number": "BY325", "airline_iata": "BY", "airline_icao": "TUI",
        "on_ground": 0, "vertical_speed": 0, "callsign": "TOM3XD",
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def test_happy_path(client, monkeypatch):
    monkeypatch.setattr(app._fr24_client, "get_flights", lambda bounds=None: [fake_flight()])

    resp = client.get("/api/flightradar24")
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["flights"]) == 1
    flight = data["flights"][0]
    assert flight["icao_24bit"] == "407739"
    assert flight["callsign"] == "TOM3XD"
    assert flight["origin_airport_iata"] == "HRG"
    assert flight["destination_airport_iata"] == "BRS"


def test_cache_within_interval(client, monkeypatch):
    calls = []
    monkeypatch.setattr(
        app._fr24_client, "get_flights",
        lambda bounds=None: calls.append(1) or [fake_flight()],
    )

    client.get("/api/flightradar24")
    client.get("/api/flightradar24")
    # Should use cache on the second call.
    assert len(calls) == 1


def test_stale_fallback_on_cloudflare_error(client, monkeypatch):
    monkeypatch.setattr(app._fr24_client, "get_flights", lambda bounds=None: [fake_flight()])
    client.get("/api/flightradar24")
    # Expire the cache.
    app._flightradar24_cache["ts"] = 0.0

    def raise_cloudflare(bounds=None):
        raise CloudflareError("blocked", response=None)

    monkeypatch.setattr(app._fr24_client, "get_flights", raise_cloudflare)
    resp = client.get("/api/flightradar24")
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["stale"] is True
    assert data["flights"][0]["icao_24bit"] == "407739"


def test_stale_fallback_on_unexpected_exception(client, monkeypatch):
    """The fetch helper deliberately catches bare Exception, not just the
    SDK's own FlightRadarError family, since it wraps a third-party client
    whose failure surface (curl_cffi errors, parsing errors, etc.) isn't
    fully known/typed. A generic ValueError must degrade the same way."""
    monkeypatch.setattr(app._fr24_client, "get_flights", lambda bounds=None: [fake_flight()])
    client.get("/api/flightradar24")
    app._flightradar24_cache["ts"] = 0.0

    def raise_generic(bounds=None):
        raise ValueError("Not a gzipped file")

    monkeypatch.setattr(app._fr24_client, "get_flights", raise_generic)
    resp = client.get("/api/flightradar24")
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["stale"] is True


def test_cold_start_error_returns_502(client, monkeypatch):
    def raise_cloudflare(bounds=None):
        raise CloudflareError("blocked", response=None)

    monkeypatch.setattr(app._fr24_client, "get_flights", raise_cloudflare)
    resp = client.get("/api/flightradar24")
    assert resp.status_code == 502
    assert resp.get_json()["flights"] == []
