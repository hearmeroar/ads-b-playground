import app


def test_index_serves_html(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"leaflet" in resp.data


def test_api_config(client):
    resp = client.get("/api/config")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["center"] == app.AREA_CENTER
    assert data["zoom"] == app.AREA_ZOOM
    assert data["radius_nm"] == app.AREA_RADIUS_NM
    assert data["ui"]["map"]["altitude_color"] == {
        "visible": True,
        "enabled_by_default": True,
    }
    assert data["ui"]["sidebar"]["accordion"]["default_collapsed"] is False
