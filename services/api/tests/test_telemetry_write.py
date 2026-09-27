"""Tests for hot-path telemetry writer denormalization."""

from __future__ import annotations

from datetime import UTC
from typing import Any
from unittest.mock import MagicMock

from homehub_api.iot.telemetry import (
    _tenant_pk_for_device,
    reading_expires_at,
    reading_is_live,
    write_telemetry,
)


class _FakeTable:
    def __init__(self, device_item: dict[str, Any] | None) -> None:
        self.device_item = device_item
        self.put_items: list[dict[str, Any]] = []
        self.update_kwargs: list[dict[str, Any]] = []

    def get_item(self, Key: dict[str, str]) -> dict[str, Any]:  # noqa: N803
        if Key.get("PK") in {"SIMULATOR", "DEVICE_REGISTRY"}:
            return {}
        if self.device_item and Key.get("SK") == self.device_item.get("SK"):
            return {"Item": self.device_item}
        return {}

    def put_item(self, Item: dict[str, Any]) -> None:  # noqa: N803
        self.put_items.append(Item)

    def update_item(self, **kwargs: Any) -> None:
        self.update_kwargs.append(kwargs)


def test_write_telemetry_denormalizes_last_and_recent_readings(
    monkeypatch: Any,
) -> None:
    device_id = "dev-1"
    device_item = {
        "PK": "HUB#demo",
        "SK": f"DEVICE#{device_id}",
        "deviceId": device_id,
        "name": "Kitchen",
        "type": "environmental-sensor",
        "status": "UNKNOWN",
        "configuration": None,
        "recentReadings": [
            {
                "readingId": "old",
                "deviceId": device_id,
                "alarm": False,
                "state": "normal",
                "metrics": {"humidity": 40},
                "recordedAt": "2026-07-15T11:00:00Z",
                "createdAt": "2026-07-15T11:00:00Z",
            }
        ],
    }
    fake_table = _FakeTable(device_item)

    resource = MagicMock()
    resource.Table.return_value = fake_table
    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setattr(
        "homehub_api.iot.telemetry.boto3.resource",
        lambda _service: resource,
    )

    write_telemetry(
        {
            "deviceId": device_id,
            "metrics": {"humidity": 55.0},
            "recordedAt": "2026-07-15T12:00:00Z",
        }
    )

    assert len(fake_table.put_items) == 1
    assert fake_table.put_items[0]["SK"].startswith(f"READING#{device_id}#")
    assert fake_table.put_items[0]["expiresAt"] == reading_expires_at("2026-07-15T12:00:00Z")
    assert fake_table.put_items[0]["expiresAt"] == reading_expires_at("2026-07-15T12:00:00Z")
    assert len(fake_table.update_kwargs) == 1

    values = fake_table.update_kwargs[0]["ExpressionAttributeValues"]
    assert values[":lastReading"]["metrics"]["humidity"] is not None
    assert values[":recentReadings"][0]["readingId"] == values[":lastReading"]["readingId"]
    assert values[":recentReadings"][1]["readingId"] == "old"
    assert values[":status"] == "ONLINE"
    assert "#status = :status" in fake_table.update_kwargs[0]["UpdateExpression"]


def test_write_telemetry_honors_explicit_tenant(monkeypatch: Any) -> None:
    device_id = "matter-2"
    device_item = {
        "PK": "HOUSEHOLD#user-1",
        "SK": f"DEVICE#{device_id}",
        "deviceId": device_id,
        "name": "TIMMERFLOTTE 1",
        "type": "environmental-sensor",
        "status": "ONLINE",
        "configuration": None,
    }
    fake_table = _FakeTable(device_item)
    resource = MagicMock()
    resource.Table.return_value = fake_table
    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setattr(
        "homehub_api.iot.telemetry.boto3.resource",
        lambda _service: resource,
    )

    write_telemetry(
        {
            "tenantPk": "HUB#user-1",
            "deviceId": device_id,
            "metrics": {"temperature": 23.4, "humidity": 61.0},
            "recordedAt": "2026-09-09T23:00:00Z",
        }
    )

    assert fake_table.update_kwargs[0]["Key"]["PK"] == "HOUSEHOLD#user-1"
    assert fake_table.put_items[0]["PK"] == "HOUSEHOLD#user-1"
    assert fake_table.put_items[0]["metrics"]["temperature"] is not None


def test_write_telemetry_keeps_offline_devices_offline(monkeypatch: Any) -> None:
    device_id = "dev-offline"
    device_item = {
        "PK": "HUB#demo",
        "SK": f"DEVICE#{device_id}",
        "deviceId": device_id,
        "name": "Basement",
        "type": "environmental-sensor",
        "status": "OFFLINE",
        "configuration": None,
    }
    fake_table = _FakeTable(device_item)

    resource = MagicMock()
    resource.Table.return_value = fake_table
    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setattr(
        "homehub_api.iot.telemetry.boto3.resource",
        lambda _service: resource,
    )

    write_telemetry(
        {
            "deviceId": device_id,
            "metrics": {"temperature": 22.0, "heat": False},
            "recordedAt": "2026-07-15T12:00:00Z",
        }
    )

    values = fake_table.update_kwargs[0]["ExpressionAttributeValues"]
    names = fake_table.update_kwargs[0]["ExpressionAttributeNames"]
    assert ":status" not in values
    assert "#status" not in names
    assert values[":lastReading"]["deviceId"] == device_id


def test_write_telemetry_stores_snapshot_key(monkeypatch: Any) -> None:
    device_id = "cam-1"
    device_item = {
        "PK": "HUB#demo",
        "SK": f"DEVICE#{device_id}",
        "deviceId": device_id,
        "name": "Hallway",
        "type": "camera",
        "status": "UNKNOWN",
        "configuration": None,
    }
    fake_table = _FakeTable(device_item)

    resource = MagicMock()
    resource.Table.return_value = fake_table
    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setattr(
        "homehub_api.iot.telemetry.boto3.resource",
        lambda _service: resource,
    )

    write_telemetry(
        {
            "deviceId": device_id,
            "metrics": {"pan": 90, "tilt": 45},
            "snapshotKey": "snapshots/cam-1/frame.jpg",
            "recordedAt": "2026-08-14T12:00:00Z",
        }
    )

    values = fake_table.update_kwargs[0]["ExpressionAttributeValues"]
    assert values[":lastSnapshotKey"] == "snapshots/cam-1/frame.jpg"
    assert values[":lastSnapshotAt"] == "2026-08-14T12:00:00Z"
    assert "#lastSnapshotKey = :lastSnapshotKey" in fake_table.update_kwargs[0]["UpdateExpression"]
    assert len(fake_table.put_items) == 2
    assert fake_table.put_items[1]["SK"].startswith(f"SNAPSHOT#{device_id}#")
    assert fake_table.put_items[1]["snapshotKey"] == "snapshots/cam-1/frame.jpg"


def test_write_telemetry_stores_occupied_and_household_snapshot_key(monkeypatch: Any) -> None:
    device_id = "cam-1"
    device_item = {
        "PK": "HOUSEHOLD#family-1",
        "SK": f"DEVICE#{device_id}",
        "deviceId": device_id,
        "name": "Hallway",
        "type": "camera",
        "status": "UNKNOWN",
        "configuration": None,
    }
    fake_table = _FakeTable(device_item)

    resource = MagicMock()
    resource.Table.return_value = fake_table
    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setattr(
        "homehub_api.iot.telemetry.boto3.resource",
        lambda _service: resource,
    )

    write_telemetry(
        {
            "hubId": "HOUSEHOLD#family-1",
            "deviceId": device_id,
            "recordedAt": "2026-09-17T15:42:00Z",
            "snapshotKey": "snapshots/family-1/cam-1/2026-09-17T154200Z.jpg",
            "metrics": {"occupied": True},
        }
    )

    values = fake_table.update_kwargs[0]["ExpressionAttributeValues"]
    assert values[":lastSnapshotKey"] == "snapshots/family-1/cam-1/2026-09-17T154200Z.jpg"
    assert values[":lastReading"]["metrics"]["occupied"] is True
    assert fake_table.put_items[0]["metrics"]["occupied"] is True
    assert fake_table.put_items[1]["PK"] == "HOUSEHOLD#family-1"


def test_write_telemetry_publishes_camera_snapshot_event(monkeypatch: Any) -> None:
    device_id = "cam-1"
    device_item = {
        "PK": "HOUSEHOLD#family-1",
        "SK": f"DEVICE#{device_id}",
        "deviceId": device_id,
        "type": "camera",
        "status": "UNKNOWN",
    }
    fake_table = _FakeTable(device_item)
    resource = MagicMock()
    resource.Table.return_value = fake_table
    published: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setenv("APPSYNC_EVENTS_HTTP_URL", "https://example.com/event")
    monkeypatch.setattr("homehub_api.iot.telemetry.boto3.resource", lambda _service: resource)
    monkeypatch.setattr(
        "homehub_api.iot.household_events.publish_household_event",
        lambda channel, payload: published.append((channel, payload)),
    )

    write_telemetry(
        {
            "hubId": "HOUSEHOLD#family-1",
            "deviceId": device_id,
            "recordedAt": "2026-09-21T00:00:00Z",
            "snapshotKey": "snapshots/family-1/cam-1/2026-09-21T000000Z.jpg",
        }
    )

    assert published == [
        (
            "household/family-1",
            {
                "type": "device.updated.v1",
                "eventId": "cam-1:updated:2026-09-21T00:00:00Z",
                "deviceId": "cam-1",
                "recordedAt": "2026-09-21T00:00:00Z",
                "status": "ONLINE",
            },
        ),
        (
            "household/family-1",
            {
                "type": "camera.snapshot.v1",
                "eventId": "cam-1:2026-09-21T00:00:00Z",
                "deviceId": "cam-1",
                "recordedAt": "2026-09-21T00:00:00Z",
            },
        ),
    ]


def test_write_telemetry_publishes_camera_device_update(monkeypatch: Any) -> None:
    device_id = "cam-1"
    device_item = {
        "PK": "HOUSEHOLD#family-1",
        "SK": f"DEVICE#{device_id}",
        "deviceId": device_id,
        "type": "camera",
        "status": "UNKNOWN",
    }
    fake_table = _FakeTable(device_item)
    resource = MagicMock()
    resource.Table.return_value = fake_table
    published: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setenv("APPSYNC_EVENTS_HTTP_URL", "https://example.com/event")
    monkeypatch.setattr("homehub_api.iot.telemetry.boto3.resource", lambda _service: resource)
    monkeypatch.setattr(
        "homehub_api.iot.household_events.publish_household_event",
        lambda channel, payload: published.append((channel, payload)),
    )

    write_telemetry(
        {
            "hubId": "HOUSEHOLD#family-1",
            "deviceId": device_id,
            "recordedAt": "2026-09-21T00:00:00Z",
            "metrics": {"occupied": True},
        }
    )

    assert published == [
        (
            "household/family-1",
            {
                "type": "device.updated.v1",
                "eventId": "cam-1:updated:2026-09-21T00:00:00Z",
                "deviceId": "cam-1",
                "recordedAt": "2026-09-21T00:00:00Z",
                "status": "ONLINE",
                "occupied": True,
            },
        )
    ]


def test_registered_device_tenant_wins_over_payload_hub() -> None:
    class RegistryTable:
        def get_item(self, Key: dict[str, str]) -> dict[str, Any]:  # noqa: N803
            if Key == {"PK": "SIMULATOR", "SK": "DEVICE#dev-1"}:
                return {"Item": {"tenantPk": "HUB#trusted-user"}}
            return {}

    tenant_pk = _tenant_pk_for_device(
        RegistryTable(),
        "dev-1",
        {"hubId": "attacker-controlled"},
    )
    assert tenant_pk == "HOUSEHOLD#trusted-user"


def test_reading_ttl_helpers() -> None:
    from datetime import datetime

    expires = reading_expires_at("2026-09-10T12:00:00Z")
    still_live = datetime(2026, 9, 10, 12, 30, tzinfo=UTC)
    expired = datetime(2026, 9, 10, 13, 0, 1, tzinfo=UTC)
    assert reading_is_live({"expiresAt": expires}, now=still_live)
    assert not reading_is_live({"expiresAt": expires}, now=expired)
    assert not reading_is_live({})
