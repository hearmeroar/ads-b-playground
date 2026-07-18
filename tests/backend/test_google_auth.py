from unittest.mock import MagicMock

import app
from conftest import login_as


def test_login_google_not_configured_by_default(client):
    # conftest's no_google_oauth_by_default fixture leaves GOOGLE_CLIENT_ID/
    # SECRET unset, mirroring how FlightAware reports not_configured when
    # its own API key is missing.
    resp = client.get("/api/login/google")
    assert resp.status_code == 503
    assert resp.get_json() == {"error": "not_configured"}


def test_callback_not_configured_by_default(client):
    resp = client.get("/api/login/google/callback")
    assert resp.status_code == 503
    assert resp.get_json() == {"error": "not_configured"}


def test_login_google_redirects_when_configured(client, monkeypatch):
    monkeypatch.setattr(app, "GOOGLE_CLIENT_ID", "fake-client-id")
    monkeypatch.setattr(app, "GOOGLE_CLIENT_SECRET", "fake-client-secret")
    monkeypatch.setattr(
        app.oauth.google, "authorize_redirect",
        MagicMock(return_value=app.redirect("https://accounts.google.com/fake-auth")),
    )
    resp = client.get("/api/login/google")
    assert resp.status_code in (302, 303)
    app.oauth.google.authorize_redirect.assert_called_once()


def test_callback_creates_user_and_sets_session(client, monkeypatch):
    monkeypatch.setattr(app, "GOOGLE_CLIENT_ID", "fake-client-id")
    monkeypatch.setattr(app, "GOOGLE_CLIENT_SECRET", "fake-client-secret")
    fake_token = {
        "userinfo": {
            "sub": "google-sub-123",
            "email": "pilot@example.com",
            "name": "Pilot Example",
            "picture": "https://example.com/pic.jpg",
        }
    }
    monkeypatch.setattr(
        app.oauth.google, "authorize_access_token",
        MagicMock(return_value=fake_token),
    )
    resp = client.get("/api/login/google/callback")
    assert resp.status_code in (302, 303)
    assert "google-sub-123" in app._users
    assert app._users["google-sub-123"]["email"] == "pilot@example.com"

    me = client.get("/api/me")
    assert me.get_json()["user"]["sub"] == "google-sub-123"


def test_callback_missing_sub_is_an_error(client, monkeypatch):
    monkeypatch.setattr(app, "GOOGLE_CLIENT_ID", "fake-client-id")
    monkeypatch.setattr(app, "GOOGLE_CLIENT_SECRET", "fake-client-secret")
    monkeypatch.setattr(
        app.oauth.google, "authorize_access_token",
        MagicMock(return_value={"userinfo": {}}),
    )
    resp = client.get("/api/login/google/callback")
    assert resp.status_code == 502


def test_me_reports_logged_out_by_default(client):
    resp = client.get("/api/me")
    assert resp.get_json() == {"user": None}


def test_login_as_helper_reflected_in_me(client):
    app._users["u1"] = {"sub": "u1", "email": "a@b.com", "name": "A", "picture": None, "created_ts": 0}
    login_as(client, "u1")
    resp = client.get("/api/me")
    assert resp.get_json()["user"]["sub"] == "u1"


def test_logout_clears_session(client):
    app._users["u1"] = {"sub": "u1", "email": "a@b.com", "name": "A", "picture": None, "created_ts": 0}
    login_as(client, "u1")
    resp = client.post("/api/logout")
    assert resp.get_json() == {"ok": True}
    assert client.get("/api/me").get_json() == {"user": None}


def test_users_persist_to_disk_and_reload(client, monkeypatch, tmp_path):
    users_file = tmp_path / "users_roundtrip.jsonl"
    monkeypatch.setattr(app, "USERS_FILE", str(users_file))
    app._users["u1"] = {
        "sub": "u1", "email": "a@b.com", "name": "A", "picture": None, "created_ts": 1.0,
    }
    app._save_users()
    assert users_file.exists()

    app._users.clear()
    app._load_users()
    assert app._users["u1"]["email"] == "a@b.com"
