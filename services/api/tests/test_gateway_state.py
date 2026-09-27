from decimal import Decimal

from homehub_api.hub_state import dynamo_safe
from homehub_api.iot.gateway_state import apply_gateway_readings, handler


def _install(monkeypatch, table) -> None:
    class FakeResource:
        def Table(self, _name):
            return table

    monkeypatch.setenv("TABLE_NAME", "test-table")
    import homehub_api.iot.gateway_state as gateway_state

    gateway_state._table = None
    monkeypatch.setattr(gateway_state.boto3, "resource", lambda _name: FakeResource())


class _BaseTable:
    def scan(self, **_kwargs):
        raise AssertionError("gateway state must not scan")

    def query(self, **_kwargs):
        return {"Items": []}


def test_gateway_state_keeps_website_added_light(monkeypatch) -> None:
    stored: list[dict[str, object]] = []

    class FakeTable(_BaseTable):
        def put_item(self, Item, **_kwargs):
            stored.append(Item)

        def get_item(self, Key):
            if Key.get("SK") == "HUB_STATE":
                return {
                    "Item": {
                        "state": {
                            "lights": [
                                {
                                    "id": "matter-1",
                                    "name": "KAJPLATS",
                                    "on": True,
                                    "brightness": 100,
                                },
                                {
                                    "id": "matter-11",
                                    "name": "KAJPLATS 2",
                                    "on": True,
                                    "brightness": 100,
                                },
                            ]
                        }
                    }
                }
            return {}

    _install(monkeypatch, FakeTable())
    result = handler(
        {
            "gatewayId": "cores3-gateway",
            "hubId": "demo",
            "state": {
                "lights": [{"id": "matter-1", "name": "KAJPLATS", "on": False, "brightness": 40}],
            },
        },
        None,
    )

    assert result["status"] == "ok"
    lights = stored[0]["state"]["lights"]
    assert [light["id"] for light in lights] == ["matter-1", "matter-11"]
    assert lights[0]["on"] is False
    assert stored[0]["PK"] == "HOUSEHOLD#demo"
    assert stored[0]["revision"] == 1


def test_gateway_state_drops_null_lock(monkeypatch) -> None:
    stored: list[dict[str, object]] = []

    class FakeTable(_BaseTable):
        def put_item(self, Item, **_kwargs):
            stored.append(Item)

        def get_item(self, Key):
            return {}

    _install(monkeypatch, FakeTable())
    result = handler(
        {
            "gatewayId": "cores3-gateway",
            "hubId": "demo",
            "recordedAt": "2026-09-09T22:00:00Z",
            "state": {
                "lock": None,
                "lights": [{"id": "matter-1", "name": "KAJPLATS", "on": True, "brightness": 100}],
                "firmware": "heap-diag-1",
                "memory": {"internalFree": 42000, "spiramFree": 5100000},
            },
        },
        None,
    )

    assert result["status"] == "ok"
    item = stored[0]
    assert item["PK"] == "HOUSEHOLD#demo"
    assert item["gatewayId"] == "cores3-gateway"
    assert "lock" not in item["state"]
    assert item["state"]["lights"][0]["id"] == "matter-1"
    assert item["state"]["firmware"] == "heap-diag-1"
    assert item["state"]["memory"]["internalFree"] == 42000


def test_dynamo_safe_converts_climate_floats() -> None:
    safe = dynamo_safe(
        {
            "climates": [{"id": "matter-2", "temperature": 23.17, "humidity": 66.61}],
            "lock": None,
        }
    )
    climate = safe["climates"][0]
    assert climate["temperature"] == Decimal("23.17")
    assert climate["humidity"] == Decimal("66.61")
    assert "lock" not in safe


def test_gateway_state_persists_climate_floats(monkeypatch) -> None:
    stored: list[dict[str, object]] = []

    class FakeTable(_BaseTable):
        def put_item(self, Item, **_kwargs):
            stored.append(Item)

        def get_item(self, Key):
            return {}

    _install(monkeypatch, FakeTable())
    result = handler(
        {
            "gatewayId": "cores3-gateway",
            "hubId": "demo",
            "recordedAt": "2026-09-11T22:44:50Z",
            "state": {
                "climates": [
                    {
                        "id": "matter-2",
                        "name": "TIMMERFLOTTE 1",
                        "temperature": 23.17,
                        "humidity": 66.61,
                    }
                ],
                "firmware": "grillplats-plug-2",
            },
        },
        None,
    )

    assert result["status"] == "ok"
    climate = stored[0]["state"]["climates"][0]
    assert climate["temperature"] == Decimal("23.17")
    assert climate["humidity"] == Decimal("66.61")


def test_gateway_state_writes_readings_to_known_devices(monkeypatch) -> None:
    writes: list[dict[str, object]] = []

    class FakeTable(_BaseTable):
        def put_item(self, Item, **_kwargs):
            return None

        def get_item(self, Key):
            if Key.get("SK") == "DEVICE#matter-2" and Key.get("PK") in {
                "HOUSEHOLD#abc",
                "HOUSEHOLD#demo",
            }:
                return {"Item": {"deviceId": "matter-2", "type": "environmental-sensor"}}
            return {}

    import homehub_api.iot.gateway_state as gateway_state

    gateway_state._table = None
    monkeypatch.setattr(gateway_state, "write_telemetry", lambda event: writes.append(event))

    written = apply_gateway_readings(
        [{"deviceId": "matter-2", "metrics": {"temperature": 24.1, "humidity": 55.0}}],
        recorded_at="2026-09-09T23:00:00Z",
        tenant_pks=["HOUSEHOLD#demo", "HOUSEHOLD#abc", "HOUSEHOLD#missing"],
        table=FakeTable(),
    )

    assert written == 2
    assert {item["tenantPk"] for item in writes} == {"HOUSEHOLD#demo", "HOUSEHOLD#abc"}
    assert writes[0]["metrics"]["temperature"] == 24.1


def test_gateway_state_uses_gateway_lookup(monkeypatch) -> None:
    stored: list[dict[str, object]] = []

    class FakeTable(_BaseTable):
        def put_item(self, Item, **_kwargs):
            stored.append(Item)

        def get_item(self, Key):
            if Key == {"PK": "GATEWAY#cores3-gateway", "SK": "HOUSEHOLD"}:
                return {"Item": {"householdId": "family-1", "tenantPk": "HOUSEHOLD#family-1"}}
            return {}

    _install(monkeypatch, FakeTable())
    result = handler(
        {
            "gatewayId": "cores3-gateway",
            "hubId": "demo",
            "state": {"scene": "home"},
        },
        None,
    )
    assert result["status"] == "ok"
    assert stored[0]["PK"] == "HOUSEHOLD#family-1"


def test_gateway_state_drops_mismatched_light_card(monkeypatch) -> None:
    stored: list[dict[str, object]] = []

    class FakeTable(_BaseTable):
        def put_item(self, Item, **_kwargs):
            stored.append(Item)

        def get_item(self, Key):
            if Key.get("SK") == "HUB_STATE":
                return {
                    "Item": {
                        "state": {
                            "lights": [
                                {
                                    "id": "matter-1",
                                    "name": "KAJPLATS",
                                    "on": True,
                                    "brightness": 100,
                                },
                                {
                                    "id": "matter-2",
                                    "name": "KAJPLATS 2",
                                    "on": True,
                                    "brightness": 100,
                                },
                            ]
                        }
                    }
                }
            return {}

        def query(self, **_kwargs):
            return {
                "Items": [
                    {"deviceId": "matter-1", "type": "light", "SK": "DEVICE#matter-1"},
                    {
                        "deviceId": "matter-2",
                        "type": "environmental-sensor",
                        "SK": "DEVICE#matter-2",
                    },
                ]
            }

    _install(monkeypatch, FakeTable())
    result = handler(
        {
            "gatewayId": "cores3-gateway",
            "hubId": "demo",
            "state": {
                "lights": [
                    {"id": "matter-1", "name": "KAJPLATS", "on": True, "brightness": 100},
                    {"id": "matter-2", "name": "KAJPLATS 2", "on": True, "brightness": 100},
                ],
                "climates": [{"id": "matter-2", "name": "TIMMERFLOTTE 1", "temperature": 23.3}],
            },
        },
        None,
    )

    assert result["status"] == "ok"
    assert [light["id"] for light in stored[0]["state"]["lights"]] == ["matter-1"]


def test_gateway_state_records_contact_and_motion_flips(monkeypatch) -> None:
    stored: list[dict[str, object]] = []

    class FakeTable(_BaseTable):
        def put_item(self, Item, **_kwargs):
            stored.append(Item)

        def get_item(self, Key):
            if Key.get("SK") == "HUB_STATE":
                return {
                    "Item": {
                        "state": {
                            "contacts": [{"id": "matter-5", "name": "MYGGBETT", "state": "CLOSED"}],
                            "motions": [{"id": "matter-4", "name": "MYGGSPRAY", "state": "CLEAR"}],
                            "leaks": [{"id": "matter-7", "name": "KLIPPBOK", "state": "DRY"}],
                            "sensorHistory": {
                                "matter-5": {
                                    "kind": "contact",
                                    "events": [
                                        {
                                            "kind": "contact",
                                            "at": "2026-09-18T10:00:00Z",
                                            "value": "OPEN",
                                        }
                                    ],
                                }
                            },
                        }
                    }
                }
            return {}

    _install(monkeypatch, FakeTable())
    result = handler(
        {
            "gatewayId": "cores3-gateway",
            "hubId": "demo",
            "recordedAt": "2026-09-18T16:09:00Z",
            "state": {
                "contacts": [{"id": "matter-5", "name": "MYGGBETT", "state": "OPEN"}],
                "motions": [{"id": "matter-4", "name": "MYGGSPRAY", "state": "DETECTED"}],
                "leaks": [{"id": "matter-7", "name": "KLIPPBOK", "state": "DRY"}],
                "sensorHistory": {},
            },
        },
        None,
    )

    assert result["status"] == "ok"
    history = stored[0]["state"]["sensorHistory"]
    assert [event["value"] for event in history["matter-5"]["events"]] == ["OPEN", "OPEN"]
    assert history["matter-4"]["events"][-1]["value"] == "DETECTED"
    assert "matter-7" not in history
    durable = [item for item in stored if str(item.get("SK", "")).startswith("EVENT#")]
    assert {item["value"] for item in durable} == {"OPEN", "DETECTED"}
    assert all("expiresAt" not in item for item in durable)
