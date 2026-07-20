import app
from conftest import login_as


def test_list_requires_login(client):
    resp = client.get("/api/collection")
    assert resp.status_code == 401


def test_save_requires_login(client):
    resp = client.post("/api/collection", json={"icao24": "abc123"})
    assert resp.status_code == 401


def test_delete_requires_login(client):
    resp = client.delete("/api/collection/some-id")
    assert resp.status_code == 401


def test_save_requires_icao24(client):
    login_as(client, "u1")
    resp = client.post("/api/collection", json={"snapshot": {}})
    assert resp.status_code == 400


def test_save_and_list_happy_path(client):
    login_as(client, "u1")
    resp = client.post("/api/collection", json={
        "icao24": "4b1805",
        "snapshot": {"registration": "HB-JXA", "aircraftType": "A20N", "operator": "Swiss"},
        "photo_url": "https://cdn.example.com/pic.jpg",
        "photo_link": "https://example.com/photo/1",
        "photo_photographer": "Jane Doe",
    })
    assert resp.status_code == 201
    card = resp.get_json()
    assert card["icao24"] == "4b1805"
    assert card["snapshot"]["registration"] == "HB-JXA"
    assert card["photo_url"] == "https://cdn.example.com/pic.jpg"
    assert "id" in card and "saved_at" in card

    listed = client.get("/api/collection").get_json()["cards"]
    assert len(listed) == 1
    assert listed[0]["id"] == card["id"]


def test_snapshot_filtered_to_allowlist(client):
    login_as(client, "u1")
    resp = client.post("/api/collection", json={
        "icao24": "4b1805",
        "snapshot": {
            "registration": "HB-JXA",
            "altitudeM": 10000,   # not in SNAPSHOT_FIELDS — must be dropped
            "squawk": "7000",    # not in SNAPSHOT_FIELDS — must be dropped
            "evil_key": "payload",  # arbitrary client junk — must be dropped
        },
    })
    card = resp.get_json()
    assert card["snapshot"] == {"registration": "HB-JXA"}


def test_snapshot_drops_route_fields(client):
    # originAirport/destinationAirport describe a specific flight, not the
    # airframe being collected — removed from SNAPSHOT_FIELDS entirely.
    login_as(client, "u1")
    resp = client.post("/api/collection", json={
        "icao24": "4b1805",
        "snapshot": {
            "registration": "HB-JXA",
            "originAirport": "Zurich (ZRH)",
            "destinationAirport": "Belgrade (BEG)",
        },
    })
    card = resp.get_json()
    assert card["snapshot"] == {"registration": "HB-JXA"}


def test_snapshot_keeps_category_group(client):
    login_as(client, "u1")
    resp = client.post("/api/collection", json={
        "icao24": "4b1805",
        "snapshot": {"registration": "HB-JXA", "categoryGroup": "large"},
    })
    card = resp.get_json()
    assert card["snapshot"]["categoryGroup"] == "large"


def test_category_code_c0_is_rejected(client):
    login_as(client, "u1")
    resp = client.post("/api/collection", json={
        "icao24": "aaa111", "snapshot": {"registration": "X"}, "category_code": "C0",
    })
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "category_not_collectible"}
    assert client.get("/api/collection").get_json()["cards"] == []


def test_category_code_other_than_c0_is_allowed(client):
    login_as(client, "u1")
    resp = client.post("/api/collection", json={
        "icao24": "aaa111", "snapshot": {"registration": "X"}, "category_code": "A1",
    })
    assert resp.status_code == 201


def test_is_ground_vehicle_is_rejected(client):
    login_as(client, "u1")
    resp = client.post("/api/collection", json={
        "icao24": "aaa111", "snapshot": {"registration": "TWR"}, "is_ground_vehicle": True,
    })
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "category_not_collectible"}
    assert client.get("/api/collection").get_json()["cards"] == []


def test_resaving_same_icao24_updates_in_place(client):
    # One icao24 = one card: re-saving refreshes snapshot/photo/timestamp on
    # the existing card rather than appending a duplicate.
    login_as(client, "u1")
    first = client.post("/api/collection", json={
        "icao24": "4b1805", "snapshot": {"registration": "HB-JXA"},
        "photo_url": "https://cdn.example.com/old.jpg",
    })
    assert first.status_code == 201
    first_card = first.get_json()

    second = client.post("/api/collection", json={
        "icao24": "4b1805", "snapshot": {"registration": "HB-JXA", "operator": "Swiss"},
        "photo_url": "https://cdn.example.com/new.jpg",
    })
    assert second.status_code == 200
    second_card = second.get_json()

    assert second_card["id"] == first_card["id"]
    assert second_card["snapshot"]["operator"] == "Swiss"
    assert second_card["photo_url"] == "https://cdn.example.com/new.jpg"

    cards = client.get("/api/collection").get_json()["cards"]
    assert len(cards) == 1


def test_list_only_returns_own_cards(client):
    login_as(client, "u1")
    client.post("/api/collection", json={"icao24": "aaa111", "snapshot": {}})

    login_as(client, "u2")
    client.post("/api/collection", json={"icao24": "bbb222", "snapshot": {}})

    u2_cards = client.get("/api/collection").get_json()["cards"]
    assert len(u2_cards) == 1
    assert u2_cards[0]["icao24"] == "bbb222"

    login_as(client, "u1")
    u1_cards = client.get("/api/collection").get_json()["cards"]
    assert len(u1_cards) == 1
    assert u1_cards[0]["icao24"] == "aaa111"


def test_delete_own_card(client):
    login_as(client, "u1")
    card = client.post("/api/collection", json={"icao24": "aaa111", "snapshot": {}}).get_json()

    resp = client.delete(f"/api/collection/{card['id']}")
    assert resp.status_code == 200
    assert client.get("/api/collection").get_json()["cards"] == []


def test_cannot_delete_another_users_card(client):
    login_as(client, "u1")
    card = client.post("/api/collection", json={"icao24": "aaa111", "snapshot": {}}).get_json()

    login_as(client, "u2")
    resp = client.delete(f"/api/collection/{card['id']}")
    assert resp.status_code == 404

    login_as(client, "u1")
    assert len(client.get("/api/collection").get_json()["cards"]) == 1


def test_delete_unknown_card_is_404(client):
    login_as(client, "u1")
    resp = client.delete("/api/collection/does-not-exist")
    assert resp.status_code == 404


def test_save_with_coordinates_resolves_nearest_airport(client):
    # 44.8125, 20.4612 is right over Belgrade Nikola Tesla Airport (BEG) —
    # a real, stable OpenFlights entry, not a fixture-only value.
    login_as(client, "u1")
    resp = client.post("/api/collection", json={
        "icao24": "4b1805", "snapshot": {"registration": "HB-JXA"},
        "lat": 44.8125, "lon": 20.4612,
    })
    card = resp.get_json()
    assert card["location"]["lat"] == 44.8125
    assert card["location"]["lon"] == 20.4612
    airport = card["location"]["nearest_airport"]
    assert airport["iata"] == "BEG"
    assert airport["distance_km"] < 20


def test_save_without_coordinates_has_no_location(client):
    login_as(client, "u1")
    resp = client.post("/api/collection", json={
        "icao24": "4b1805", "snapshot": {"registration": "HB-JXA"},
    })
    assert resp.get_json()["location"] is None


def test_resaving_updates_location(client):
    login_as(client, "u1")
    client.post("/api/collection", json={
        "icao24": "4b1805", "snapshot": {"registration": "HB-JXA"},
        "lat": 44.8125, "lon": 20.4612,
    })
    second = client.post("/api/collection", json={
        "icao24": "4b1805", "snapshot": {"registration": "HB-JXA"},
        "lat": 51.4700, "lon": -0.4543,  # London Heathrow
    })
    airport = second.get_json()["location"]["nearest_airport"]
    assert airport["iata"] == "LHR"


def test_collections_persist_to_disk_and_reload(monkeypatch, tmp_path):
    collections_file = tmp_path / "collections_roundtrip.jsonl"
    monkeypatch.setattr(app, "COLLECTIONS_FILE", str(collections_file))
    app._collections.append({
        "id": "card1", "user_id": "u1", "icao24": "aaa111", "saved_at": 1.0,
        "snapshot": {"registration": "X"}, "photo_url": None,
        "photo_link": None, "photo_photographer": None,
    })
    app._save_collections()
    assert collections_file.exists()

    app._collections.clear()
    app._load_collections()
    assert app._collections[0]["icao24"] == "aaa111"
