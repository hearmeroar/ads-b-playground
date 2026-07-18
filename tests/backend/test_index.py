def test_index_serves_html(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"leaflet" in resp.data


def test_api_config(client):
    resp = client.get("/api/config")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["center"] == {"lat": 44.0, "lon": 21.0}
    assert data["zoom"] == 8
    assert data["radius_nm"] == 220
