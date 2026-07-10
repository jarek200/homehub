import pytest
from fastapi.testclient import TestClient

from homehub_api.main import create_app
from homehub_api.fake_store import FakeHubStore


@pytest.fixture
def client() -> TestClient:
    app = create_app(store=FakeHubStore())
    with TestClient(app) as test_client:
        yield test_client


def test_root_lists_endpoints(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["framework"] == "FastAPI"


def test_create_and_list_devices(client: TestClient) -> None:
    created = client.post(
        "/devices",
        json={"name": "Hallway Light", "type": "smart-light"},
    )
    assert created.status_code == 201
    device_id = created.json()["deviceId"]

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


def test_create_reading_for_device(client: TestClient) -> None:
    device = client.post(
        "/devices",
        json={"name": "Bedroom Sensor", "type": "sensor"},
    ).json()

    response = client.post(
        f"/devices/{device['deviceId']}/readings",
        json={"humidity": 72},
    )
    assert response.status_code == 201
    assert response.json()["reading"]["humidity"] == 72
    assert "issue" in response.json()


def test_send_command_for_device(client: TestClient) -> None:
    device = client.post(
        "/devices",
        json={"name": "Camera", "type": "security-camera"},
    ).json()

    response = client.post(
        f"/devices/{device['deviceId']}/commands",
        json={"command": "capture-image"},
    )
    assert response.status_code == 201
    assert response.json()["command"] == "capture-image"
    assert response.json()["status"] == "PENDING"
