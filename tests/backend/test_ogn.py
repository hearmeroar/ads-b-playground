import time

import ogn_source

# Real-shaped OGN/FLARM APRS beacon line (from the reference examples at
# wiki.glidernet.org/aprs-interaction-examples) — exercised through the
# actual ogn.parser.parse() the background thread uses, not a hand-built
# fixture dict, so a real upstream format change would be caught here.
SAMPLE_LINE = (
    "FLRDDDEAD>APRS,qAS,EDER:/114500h5029.86N/00956.98E'342/049/A=005524 "
    "id0ADDDEAD -454fpm -1.1rot 8.8dB 0e +51.2kHz gps4x5"
)


def test_process_line_populates_snapshot():
    ogn_source._process_line(SAMPLE_LINE)
    snap = ogn_source.snapshot()
    assert len(snap) == 1
    beacon = snap[0]
    assert beacon["address"] == "DDDEAD"
    assert beacon["name"] == "FLRDDDEAD"
    assert round(beacon["latitude"], 2) == 50.50
    assert round(beacon["longitude"], 2) == 9.95
    assert beacon["altitude"] is not None
    assert "_received_ts" not in beacon


def test_process_line_ignores_server_and_comment_lines():
    ogn_source._process_line("# aprsc 2.1.19-g730c5c0 1 Jan 2026 00:00:00 GMT GLIDERN1 1.2.3.4:14580")
    ogn_source._process_line("")
    assert ogn_source.snapshot() == []


def test_process_line_ignores_unparsable_garbage():
    # Must never raise — a malformed line from a public third-party network
    # can't be allowed to kill the connection.
    ogn_source._process_line("not a valid aprs line at all")
    assert ogn_source.snapshot() == []


def test_snapshot_prunes_stale_beacons():
    ogn_source._process_line(SAMPLE_LINE)
    address = ogn_source.snapshot()[0]["address"]
    with ogn_source._lock:
        ogn_source._beacons[address]["_received_ts"] = time.time() - ogn_source.STALE_SECONDS - 1
    assert ogn_source.snapshot() == []


def test_clear_drops_everything():
    ogn_source._process_line(SAMPLE_LINE)
    assert len(ogn_source.snapshot()) == 1
    ogn_source.clear()
    assert ogn_source.snapshot() == []


def test_build_filter_format():
    assert ogn_source._build_filter(48.8566, 2.3522, 220 * 1.852) == "r/48.8566/2.3522/407"


def test_set_range_updates_filter_and_disconnects_live_client(monkeypatch):
    disconnected = []
    fake_client = type("FakeClient", (), {"disconnect": lambda self: disconnected.append(True)})()
    ogn_source._client_holder["client"] = fake_client
    try:
        ogn_source.set_range(10.0, 20.0, 100.0)
        assert ogn_source._current_filter == "r/10.0000/20.0000/100"
        assert disconnected == [True]
    finally:
        ogn_source._client_holder["client"] = None


def test_api_ogn_route_returns_snapshot(client):
    ogn_source._process_line(SAMPLE_LINE)
    resp = client.get("/api/ogn")
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["aircraft"]) == 1
    assert data["aircraft"][0]["address"] == "DDDEAD"


def test_api_ogn_route_empty_when_nothing_seen(client):
    resp = client.get("/api/ogn")
    assert resp.status_code == 200
    assert resp.get_json() == {"aircraft": []}


def test_apply_zone_updates_ogn_filter_and_clears_snapshot(client):
    import app
    ogn_source._process_line(SAMPLE_LINE)
    assert len(ogn_source.snapshot()) == 1
    app._apply_zone({"lat": 1.0, "lon": 2.0}, app.AREA_ZOOM, 50, "custom")
    assert ogn_source.snapshot() == []
    assert ogn_source._current_filter == ogn_source._build_filter(1.0, 2.0, 50 * 1.852)


def test_ogn_in_sources_config(client):
    resp = client.get("/api/config")
    data = resp.get_json()
    assert "ogn" in data["sources"]
    assert data["sources"]["ogn"] == {"visible": True, "enabled_by_default": False}
