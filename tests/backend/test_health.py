"""Tests for /api/health endpoint (deployment monitoring)."""
import json
import pytest


def test_health_happy_path(client):
    """Happy path: /api/health returns 200 with {"status": "ok"}."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["status"] == "ok"


def test_health_degraded_on_db_error(client, monkeypatch):
    """Degraded path: if SQLite connection fails, return 503 with error message."""
    import storage

    def mock_get_connection():
        raise RuntimeError("Database connection failed")

    monkeypatch.setattr(storage, "get_connection", mock_get_connection)

    response = client.get("/api/health")
    assert response.status_code == 503
    data = json.loads(response.data)
    assert data["status"] == "degraded"
    assert "connection failed" in data["message"].lower()


def test_health_response_does_not_leak_secrets(client):
    """Negative test: response must NOT include quotas, config, or per-source health."""
    response = client.get("/api/health")
    data = json.loads(response.data)
    data_str = json.dumps(data)

    # Sensitive terms that should NOT appear in health response
    forbidden = ["quota", "opensky", "adsb", "flightaware", "zone", "bbox", "config"]
    for term in forbidden:
        assert term.lower() not in data_str.lower(), f"Response leaked '{term}'"
