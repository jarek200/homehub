from fastapi.testclient import TestClient

from homehub_api.fake_store import FakeHubStore
from homehub_api.main import create_app


def test_create_matter_light_skips_provisioning() -> None:
    app = create_app(store=FakeHubStore())
    with TestClient(app) as client:
        response = client.post(
            "/devices",
            json={
                "name": "Living Room Light",
                "type": "light",
                "location": "Living room",
                "runtimeKind": "matter",
                "gatewayId": "gw1",
                "nodeId": 15,
                "endpoint": 1,
                "clusters": ["onoff", "level"],
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["runtimeKind"] == "matter"
        assert body["lifecycleStatus"] == "READY"
        assert body["status"] == "ONLINE"
        assert body["gatewayId"] == "gw1"
        assert body["nodeId"] == 15
        assert body["clusters"] == ["onoff", "level"]


def test_create_matter_gateway_still_provisions() -> None:
    app = create_app(store=FakeHubStore())
    with TestClient(app) as client:
        response = client.post(
            "/devices",
            json={
                "name": "CoreS3 Gateway",
                "type": "matter-gateway",
                "location": "Hallway",
                "runtimeKind": "physical",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["type"] == "matter-gateway"
        assert body["lifecycleStatus"] == "PROVISIONING"
