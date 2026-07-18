def test_index_serves_html(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"leaflet" in resp.data
