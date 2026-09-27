from fastapi.testclient import TestClient

from homehub_api.cores3_products import (
    next_matter_device_id,
    next_matter_node_id,
    next_product_name,
)
from homehub_api.fake_store import FakeHubStore
from homehub_api.hub_state import drop_mismatched_household_cards, merge_household_state
from homehub_api.iot.gateway_commands import compact_runtime_fabric
from homehub_api.main import create_app
from homehub_api.matter_commission import complete_commission
from homehub_api.matter_devices import compact_runtime_fabric as devices_fabric
from homehub_api.models import CreateDeviceRequest


def test_next_ids_skip_reserved_nodes() -> None:
    assert next_matter_device_id(["matter-1", "matter-10"]) == "matter-11"
    assert next_matter_node_id([1, 2, 3, 4, 5, 7, 9, 10, 11]) == 12
    assert next_product_name("KAJPLATS", ["KAJPLATS"]) == "KAJPLATS 2"


def test_list_matter_products() -> None:
    with TestClient(create_app(store=FakeHubStore())) as client:
        response = client.get("/matter/products")
        assert response.status_code == 200
        ids = [item["productId"] for item in response.json()["items"]]
        assert ids == [
            "kajplats",
            "timmerflotte",
            "myggspray",
            "myggbett",
            "alpstuga",
            "klippbok",
            "grillplats",
        ]


def _gateway_store() -> FakeHubStore:
    store = FakeHubStore()
    store.create_device(
        CreateDeviceRequest(
            name="CoreS3 Thread gateway",
            type="matter-gateway",
            location="Home",
            runtime_kind="physical",
        ),
        device_id="cores3-gateway",
    )
    store.create_device(
        CreateDeviceRequest(
            name="KAJPLATS",
            type="light",
            location="Home",
            runtime_kind="matter",
            gateway_id="cores3-gateway",
            node_id=1,
            endpoint=1,
            clusters=["onoff", "level"],
        ),
        device_id="matter-1",
    )
    return store


def test_commission_does_not_create_device_until_pair() -> None:
    store = _gateway_store()
    with TestClient(create_app(store=store)) as client:
        response = client.post(
            "/matter/commission",
            json={
                "productId": "kajplats",
                "setupPayload": "34970112332",
                "name": "KAJPLATS 2",
                "location": "Kitchen",
            },
        )
        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "pairing"
        assert body["nodeId"] == 2
        assert body["gatewayId"] == "cores3-gateway"
        assert "setupPayload" not in body
        assert store.get_device("matter-2") is None
        assert all(
            item.get("id") != "matter-2" for item in store.get_hub_state().get("lights") or []
        )

        created = complete_commission(store, body["commissionId"], "commissioned")
        assert created["status"] == "succeeded"
        assert created["deviceId"] == "matter-2"
        device = store.get_device("matter-2")
        assert device is not None
        assert device.node_id == 2
        assert device.gateway_id == "cores3-gateway"
        assert [light["id"] for light in store.get_hub_state()["lights"]] == [
            "matter-1",
            "matter-11",
            "matter-2",
        ]

        polled = client.get(f"/matter/commission/{body['commissionId']}")
        assert polled.status_code == 200
        assert polled.json()["status"] == "succeeded"


def test_get_commission_completes_from_pair_result() -> None:
    store = _gateway_store()
    with TestClient(create_app(store=store)) as client:
        started = client.post(
            "/matter/commission",
            json={"productId": "kajplats", "setupPayload": "34970112332"},
        ).json()
        store.put_pair_result("cores3-gateway", started["nodeId"], "commissioned")
        polled = client.get(f"/matter/commission/{started['commissionId']}")
        assert polled.status_code == 200
        assert polled.json()["status"] == "succeeded"
        assert store.get_device(polled.json()["deviceId"]) is not None


def test_commission_failure_leaves_devices_unchanged() -> None:
    store = _gateway_store()
    with TestClient(create_app(store=store)) as client:
        response = client.post(
            "/matter/commission",
            json={"productId": "kajplats", "setupPayload": "34970112332"},
        )
        complete_commission(store, response.json()["commissionId"], "commission-failed", "timeout")
        assert store.get_device("matter-2") is None
        polled = client.get(f"/matter/commission/{response.json()['commissionId']}")
        assert polled.json()["status"] == "failed"
        assert polled.json()["error"] == "timeout"


def test_unknown_product_is_rejected() -> None:
    with TestClient(create_app(store=FakeHubStore())) as client:
        response = client.post(
            "/matter/commission",
            json={"productId": "not-a-product", "setupPayload": "34970112332"},
        )
        assert response.status_code == 400


def test_invalid_matter_code_is_rejected() -> None:
    with TestClient(create_app(store=FakeHubStore())) as client:
        response = client.post(
            "/matter/commission",
            json={"productId": "kajplats", "setupPayload": "123"},
        )
        assert response.status_code == 400


def test_merge_keeps_website_added_light() -> None:
    merged = merge_household_state(
        {
            "lights": [
                {"id": "matter-1", "name": "KAJPLATS", "on": True, "brightness": 100},
                {"id": "matter-11", "name": "KAJPLATS 2", "on": True, "brightness": 100},
            ],
            "plugs": [],
        },
        {
            "lights": [{"id": "matter-1", "name": "KAJPLATS", "on": False, "brightness": 40}],
            "firmware": "fabric-catalog-1",
        },
    )
    assert [light["id"] for light in merged["lights"]] == ["matter-1", "matter-11"]
    assert merged["lights"][0]["on"] is False
    assert merged["lights"][1]["name"] == "KAJPLATS 2"


def test_merge_drops_stale_light_owned_by_another_household_list() -> None:
    merged = merge_household_state(
        {
            "lights": [
                {"id": "matter-1", "name": "KAJPLATS", "on": True, "brightness": 100},
                {"id": "matter-2", "name": "KAJPLATS 2", "on": True, "brightness": 100},
            ],
            "climates": [{"id": "matter-2", "name": "TIMMERFLOTTE 1"}],
        },
        {
            "lights": [{"id": "matter-1", "name": "KAJPLATS", "on": True, "brightness": 100}],
            "climates": [{"id": "matter-2", "name": "TIMMERFLOTTE 1", "temperature": 23.3}],
        },
    )
    assert [light["id"] for light in merged["lights"]] == ["matter-1"]
    assert merged["climates"][0]["id"] == "matter-2"


def test_compact_fabric_includes_cluster_reads() -> None:
    store = FakeHubStore()
    store.create_device(
        CreateDeviceRequest(
            name="KAJPLATS",
            type="light",
            location="Home",
            runtime_kind="matter",
            node_id=1,
            endpoint=1,
            clusters=["onoff", "level"],
        ),
        device_id="matter-1",
    )
    fabric = devices_fabric(store.list_all_devices())
    compact = compact_runtime_fabric(fabric)
    assert compact["kind"] == "fabric"
    assert compact["devices"][0]["n"] == 1
    assert compact["devices"][0]["reads"] == [
        {"e": 1, "c": 6, "a": 0},
        {"e": 1, "c": 8, "a": 0},
    ]


def test_drop_mismatched_household_cards() -> None:
    cleaned = drop_mismatched_household_cards(
        {
            "lights": [
                {"id": "matter-1", "name": "KAJPLATS"},
                {"id": "matter-2", "name": "KAJPLATS 2"},
            ],
            "climates": [{"id": "matter-2", "name": "TIMMERFLOTTE 1"}],
        },
        {"matter-1": "light", "matter-2": "environmental-sensor"},
    )
    assert [item["id"] for item in cleaned["lights"]] == ["matter-1"]
    assert cleaned["climates"][0]["id"] == "matter-2"
