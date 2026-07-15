import pytest
from fastapi.testclient import TestClient

from homehub_api.main import create_app
from homehub_api.fake_store import FakeHubStore


@pytest.fixture
def client() -> TestClient:
    app = create_app(store=FakeHubStore())
    with TestClient(app) as test_client:
        yield test_client


def create_device(client: TestClient, name: str = "Hallway Light", type: str = "heat-alarm", location: str = "Hallway") -> dict:
    response = client.post("/devices", json={"name": name, "type": type, "location": location})
    assert response.status_code == 201
    return response.json()


def test_root_lists_endpoints(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["framework"] == "FastAPI"


def test_hub_pk_for_user() -> None:
    from homehub_api.config import hub_id_from_pk, hub_pk_for_user

    assert hub_pk_for_user("user-abc") == "HUB#user-abc"
    assert hub_id_from_pk("HUB#user-abc") == "user-abc"


def test_create_and_list_devices(client: TestClient) -> None:
    created = create_device(client)
    device_id = created["deviceId"]
    assert created["lifecycleStatus"] == "PROVISIONING"
    assert created["status"] == "UNKNOWN"

    listed = client.get("/devices")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1
    assert listed.json()["items"][0]["deviceId"] == device_id


def test_get_device_not_found(client: TestClient) -> None:
    response = client.get("/devices/missing")
    assert response.status_code == 404
    assert response.json()["code"] == "NotFound"


def test_create_device_validation_error(client: TestClient) -> None:
    response = client.post("/devices", json={"type": "sensor"})
    assert response.status_code == 400
    assert response.json()["code"] == "ValidationError"


def test_update_device_status(client: TestClient) -> None:
    device = create_device(client)

    response = client.patch(
        f"/devices/{device['deviceId']}",
        json={"status": "ONLINE", "configuration": '{"power":"on"}'},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ONLINE"
    assert body["configuration"] == '{"power":"on"}'


def test_update_device_not_found(client: TestClient) -> None:
    response = client.patch("/devices/missing", json={"status": "ONLINE"})
    assert response.status_code == 404
    assert response.json()["code"] == "NotFound"


def test_update_device_requires_field(client: TestClient) -> None:
    device = create_device(client)
    response = client.patch(f"/devices/{device['deviceId']}", json={})
    assert response.status_code == 400
    assert response.json()["code"] == "ValidationError"


def test_update_device_rejects_type_change(client: TestClient) -> None:
    device = create_device(client, name="Hallway Heat", type="heat-alarm")

    response = client.patch(
        f"/devices/{device['deviceId']}",
        json={"type": "environmental-sensor"},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "ValidationError"


def test_update_device_name_and_location(client: TestClient) -> None:
    device = create_device(client, name="Hallway Heat", type="heat-alarm")

    response = client.patch(
        f"/devices/{device['deviceId']}",
        json={"name": "Living room smoke", "location": "Living room"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Living room smoke"
    assert body["location"] == "Living room"
    assert body["type"] == "heat-alarm"


def test_create_humidity_sensor(client: TestClient) -> None:
    created = create_device(
        client,
        name="Bathroom Humidity",
        type="humidity-sensor",
        location="Bathroom",
    )
    assert created["type"] == "humidity-sensor"
    assert created["lifecycleStatus"] == "PROVISIONING"


def test_create_device_requires_location(client: TestClient) -> None:
    response = client.post("/devices", json={"name": "Hallway Heat", "type": "heat-alarm"})
    assert response.status_code == 400


def test_create_device_rejects_blank_location(client: TestClient) -> None:
    response = client.post(
        "/devices",
        json={"name": "Hallway Heat", "type": "heat-alarm", "location": "   "},
    )
    assert response.status_code == 400


def test_update_device_rejects_blank_location(client: TestClient) -> None:
    device = create_device(client, name="Hallway Heat", type="heat-alarm")

    response = client.patch(
        f"/devices/{device['deviceId']}",
        json={"location": "   "},
    )
    assert response.status_code == 400


def test_delete_device(client: TestClient) -> None:
    device = create_device(client)

    deleted = client.delete(f"/devices/{device['deviceId']}")
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True, "deviceId": device["deviceId"]}

    missing = client.get(f"/devices/{device['deviceId']}")
    assert missing.status_code == 404


def test_delete_device_not_found(client: TestClient) -> None:
    response = client.delete("/devices/missing")
    assert response.status_code == 404
    assert response.json()["code"] == "NotFound"


def test_create_reading_for_device(client: TestClient) -> None:
    device = create_device(client, name="Bedroom Sensor", type="sensor")

    response = client.post(
        f"/devices/{device['deviceId']}/readings",
        json={"metrics": {"humidity": 72}},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["reading"]["metrics"]["humidity"] == 72
    assert body["issue"] is not None
    assert body["issue"]["severity"] == "HIGH"
    assert body["issue"]["status"] == "OPEN"


def test_create_reading_does_not_duplicate_issue(client: TestClient) -> None:
    device = create_device(client, name="Bathroom Sensor", type="sensor")

    first = client.post(
        f"/devices/{device['deviceId']}/readings",
        json={"metrics": {"humidity": 75}},
    )
    second = client.post(
        f"/devices/{device['deviceId']}/readings",
        json={"metrics": {"humidity": 80}},
    )

    assert first.status_code == 201
    assert first.json()["issue"] is not None
    assert second.status_code == 201
    assert second.json()["issue"] is None


def test_list_readings(client: TestClient) -> None:
    device = create_device(client, name="Kitchen Sensor", type="sensor")
    client.post(
        f"/devices/{device['deviceId']}/readings",
        json={"metrics": {"temperature": 21.5}},
    )

    response = client.get(f"/devices/{device['deviceId']}/readings")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1


def test_send_command_for_device(client: TestClient) -> None:
    device = create_device(client, name="Camera", type="security-camera")

    response = client.post(
        f"/devices/{device['deviceId']}/commands",
        json={"command": "capture-image"},
    )
    assert response.status_code == 201
    assert response.json()["command"] == "capture-image"
    assert response.json()["status"] == "PENDING"


def test_list_commands(client: TestClient) -> None:
    device = create_device(client, name="Camera", type="security-camera")
    client.post(
        f"/devices/{device['deviceId']}/commands",
        json={"command": "capture-image"},
    )

    response = client.get(f"/devices/{device['deviceId']}/commands")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1


def test_create_and_list_issues(client: TestClient) -> None:
    response = client.post(
        "/issues",
        json={
            "title": "Condensation in bedroom",
            "severity": "HIGH",
            "status": "OPEN",
        },
    )
    assert response.status_code == 201
    issue_id = response.json()["issueId"]

    listed = client.get("/issues")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1
    assert listed.json()["items"][0]["issueId"] == issue_id


def test_get_issue_not_found(client: TestClient) -> None:
    response = client.get("/issues/missing")
    assert response.status_code == 404
    assert response.json()["code"] == "NotFound"


def test_update_issue(client: TestClient) -> None:
    created = client.post(
        "/issues",
        json={"title": "Damp patch", "severity": "MEDIUM", "status": "OPEN"},
    ).json()

    response = client.patch(
        f"/issues/{created['issueId']}",
        json={"status": "RESOLVED"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "RESOLVED"
