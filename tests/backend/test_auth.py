import requests

import app
from conftest import make_response


def test_returns_none_without_credentials():
    # no_oauth_by_default already clears CLIENT_ID/CLIENT_SECRET
    assert app.get_access_token() is None


def test_caches_token_until_expiry(monkeypatch, mock_post):
    monkeypatch.setattr(app, "CLIENT_ID", "id")
    monkeypatch.setattr(app, "CLIENT_SECRET", "secret")
    mock_post.return_value = make_response(json_data={"access_token": "tok1", "expires_in": 1800})

    token1 = app.get_access_token()
    token2 = app.get_access_token()

    assert token1 == "tok1"
    assert token2 == "tok1"
    mock_post.assert_called_once()  # second call served from the in-memory cache


def test_fetch_opensky_retries_once_on_401(monkeypatch, mock_get, mock_post):
    monkeypatch.setattr(app, "CLIENT_ID", "id")
    monkeypatch.setattr(app, "CLIENT_SECRET", "secret")
    mock_post.side_effect = [
        make_response(json_data={"access_token": "expired-tok", "expires_in": 1800}),
        make_response(json_data={"access_token": "fresh-tok", "expires_in": 1800}),
    ]
    mock_get.side_effect = [
        make_response(status_code=401),
        make_response(status_code=200, json_data={"ok": True}),
    ]

    resp = app.fetch_opensky("https://example.test", {})

    assert resp.status_code == 200
    assert mock_post.call_count == 2  # dropped the expired token and fetched a new one
    assert mock_get.call_count == 2


def test_fetch_opensky_anonymous_when_no_credentials(mock_get):
    mock_get.return_value = make_response(json_data={"ok": True})
    resp = app.fetch_opensky("https://example.test", {})
    assert resp.status_code == 200
    _, kwargs = mock_get.call_args
    assert kwargs["headers"] == {}


def test_falls_back_to_anonymous_when_token_endpoint_unreachable(monkeypatch, mock_get, mock_post):
    # Reproduces the production incident: auth.opensky-network.org
    # connect-timed-out while opensky-network.org itself stayed reachable.
    # Losing the token must not fail the whole request — it should degrade
    # to an anonymous one, same as having no credentials configured at all.
    monkeypatch.setattr(app, "CLIENT_ID", "id")
    monkeypatch.setattr(app, "CLIENT_SECRET", "secret")
    mock_post.side_effect = requests.exceptions.ConnectTimeout("timed out")
    mock_get.return_value = make_response(json_data={"ok": True})

    assert app.get_access_token() is None

    resp = app.fetch_opensky("https://example.test", {})
    assert resp.status_code == 200
    _, kwargs = mock_get.call_args
    assert kwargs["headers"] == {}


def test_token_endpoint_failure_is_not_retried_within_cooldown(monkeypatch, mock_post):
    monkeypatch.setattr(app, "CLIENT_ID", "id")
    monkeypatch.setattr(app, "CLIENT_SECRET", "secret")
    mock_post.side_effect = requests.exceptions.ConnectTimeout("timed out")

    assert app.get_access_token() is None
    assert app.get_access_token() is None

    mock_post.assert_called_once()  # second call skipped the still-cooling-down endpoint
