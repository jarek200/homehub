import pytest
from fastapi.testclient import TestClient

from homehub_api.main import create_app
from homehub_api.fake_store import FakeHubStore


@pytest.fixture
def store() -> FakeHubStore:
    return FakeHubStore()


@pytest.fixture
def client(store: FakeHubStore) -> TestClient:
    app = create_app(store=store)
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
        json={"status": "ONLINE", "configuration": {"power": "on"}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ONLINE"
    assert body["configuration"] == {"power": "on"}


def test_update_device_rejects_configuration_string(client: TestClient) -> None:
    device = create_device(client)

    response = client.patch(
        f"/devices/{device['deviceId']}",
        json={"configuration": '{"power":"on"}'},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "ValidationError"


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


def test_list_readings(client: TestClient, store: FakeHubStore) -> None:
    from homehub_api.models import ReadingResponse

    device = create_device(client, name="Kitchen Sensor", type="humidity-sensor")
    timestamp = "2026-07-15T12:00:00.000000Z"
    store.readings[device["deviceId"]] = [
        ReadingResponse(
            readingId="01TESTREADING0000000000001",
            deviceId=device["deviceId"],
            alarm=False,
            state="normal",
            metrics={"humidity": 55.0},
            recordedAt=timestamp,
            createdAt=timestamp,
        )
    ]

    response = client.get(f"/devices/{device['deviceId']}/readings")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["metrics"]["humidity"] == 55.0


def test_list_devices_includes_denormalized_readings(
    client: TestClient, store: FakeHubStore
) -> None:
    from homehub_api.models import ReadingResponse

    device = create_device(client, name="Kitchen Sensor", type="humidity-sensor")
    timestamp = "2026-07-15T12:00:00.000000Z"
    reading = ReadingResponse(
        readingId="01TESTREADING0000000000001",
        deviceId=device["deviceId"],
        alarm=False,
        state="normal",
        metrics={"humidity": 55.0},
        recordedAt=timestamp,
        createdAt=timestamp,
    )
    existing = store.devices[device["deviceId"]]
    store.devices[device["deviceId"]] = existing.model_copy(
        update={"last_reading": reading, "recent_readings": [reading]}
    )

    listed = client.get("/devices")
    assert listed.status_code == 200
    item = listed.json()["items"][0]
    assert item["lastReading"]["metrics"]["humidity"] == 55.0
    assert len(item["recentReadings"]) == 1
    assert item["recentReadings"][0]["readingId"] == reading.reading_id


def test_next_recent_readings_prepends_and_caps() -> None:
    from homehub_api.iot.telemetry import RECENT_READINGS_LIMIT, _next_recent_readings

    prior = [
        {"readingId": f"r{i}", "deviceId": "d1", "recordedAt": f"t{i}", "createdAt": f"t{i}"}
        for i in range(RECENT_READINGS_LIMIT)
    ]
    snapshot = {
        "readingId": "newest",
        "deviceId": "d1",
        "recordedAt": "now",
        "createdAt": "now",
    }
    next_readings = _next_recent_readings({"recentReadings": prior}, snapshot)
    assert len(next_readings) == RECENT_READINGS_LIMIT
    assert next_readings[0]["readingId"] == "newest"
    assert next_readings[-1]["readingId"] == f"r{RECENT_READINGS_LIMIT - 2}"


def _assert_error_shape(body: dict, *, message: str, code: str) -> None:
    assert set(body.keys()) == {"error", "code"}
    assert body["error"] == message
    assert body["code"] == code


def test_auth_error_shape_when_api_key_required(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setenv("REST_API_KEY", "secret-key")

    response = client.get("/devices", headers={"X-Api-Key": "wrong-key"})

    assert response.status_code == 401
    _assert_error_shape(
        response.json(),
        message="Invalid or missing API key",
        code="Unauthorized",
    )


def test_profile_requires_cognito_user(client: TestClient) -> None:
    response = client.get("/me")

    assert response.status_code == 401
    _assert_error_shape(
        response.json(),
        message="Cognito sign-in required",
        code="Unauthorized",
    )


def test_not_found_error_shape(client: TestClient) -> None:
    response = client.get("/devices/missing")

    assert response.status_code == 404
    _assert_error_shape(response.json(), message="Device not found", code="NotFound")


def test_validation_error_shape(client: TestClient) -> None:
    response = client.post("/devices", json={"type": "sensor"})

    assert response.status_code == 400
    body = response.json()
    assert set(body.keys()) == {"error", "code"}
    assert body["code"] == "ValidationError"
    assert "name" in body["error"]


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "X-Request-Id" in response.headers


def test_ready_returns_ready_with_injected_store(client: TestClient) -> None:
    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_ready_checks_dynamodb_when_not_injected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TABLE_NAME", "HomeHubTable")

    class FakeDynamoClient:
        def describe_table(self, *, TableName: str) -> dict:
            assert TableName == "HomeHubTable"
            return {"Table": {"TableName": TableName}}

    monkeypatch.setattr(
        "homehub_api.routers.health.boto3.client",
        lambda _service: FakeDynamoClient(),
    )

    app = create_app()
    with TestClient(app) as test_client:
        response = test_client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_ready_returns_503_when_dynamodb_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from botocore.exceptions import ClientError

    monkeypatch.setenv("TABLE_NAME", "HomeHubTable")

    class FailingDynamoClient:
        def describe_table(self, *, TableName: str) -> dict:
            raise ClientError(
                {"Error": {"Code": "ResourceNotFoundException", "Message": "missing"}},
                "DescribeTable",
            )

    monkeypatch.setattr(
        "homehub_api.routers.health.boto3.client",
        lambda _service: FailingDynamoClient(),
    )

    app = create_app()
    with TestClient(app) as test_client:
        response = test_client.get("/ready")

    assert response.status_code == 503
    _assert_error_shape(
        response.json(),
        message="DynamoDB unavailable",
        code="ServiceUnavailable",
    )


def test_internal_error_shape(client: TestClient, store: FakeHubStore) -> None:
    def boom(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError("boom")

    store.list_devices = boom  # type: ignore[method-assign]

    response = client.get("/devices")

    assert response.status_code == 500
    _assert_error_shape(
        response.json(),
        message="Internal server error",
        code="InternalError",
    )


def test_request_id_is_echoed(client: TestClient) -> None:
    response = client.get("/health", headers={"x-amzn-requestid": "req-abc-123"})

    assert response.status_code == 200
    assert response.headers["X-Request-Id"] == "req-abc-123"


def test_list_devices_pagination(client: TestClient) -> None:
    create_device(client, name="Device A")
    create_device(client, name="Device B")
    create_device(client, name="Device C")

    first = client.get("/devices?limit=2")
    assert first.status_code == 200
    first_body = first.json()
    assert len(first_body["items"]) == 2
    assert first_body["nextCursor"]

    second = client.get("/devices", params={"limit": 2, "cursor": first_body["nextCursor"]})
    assert second.status_code == 200
    second_body = second.json()
    assert len(second_body["items"]) == 1
    assert second_body.get("nextCursor") is None

    all_ids = [item["deviceId"] for item in first_body["items"] + second_body["items"]]
    assert len(all_ids) == 3
    assert len(set(all_ids)) == 3


def test_list_devices_invalid_cursor(client: TestClient) -> None:
    response = client.get("/devices?cursor=not-valid")

    assert response.status_code == 400
    assert response.json()["code"] == "ValidationError"


def test_list_devices_limit_validation(client: TestClient) -> None:
    assert client.get("/devices?limit=0").status_code == 400
    assert client.get("/devices?limit=101").status_code == 400
