"""Tests for hot-path telemetry writer denormalization."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from homehub_api.iot.telemetry import write_telemetry


class _FakeTable:
    def __init__(self, device_item: dict[str, Any] | None) -> None:
        self.device_item = device_item
        self.put_items: list[dict[str, Any]] = []
        self.update_kwargs: list[dict[str, Any]] = []

    def get_item(self, Key: dict[str, str]) -> dict[str, Any]:  # noqa: N803
        if Key.get("PK") == "SIMULATOR":
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
        "type": "humidity-sensor",
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
    assert len(fake_table.update_kwargs) == 1

    values = fake_table.update_kwargs[0]["ExpressionAttributeValues"]
    assert values[":lastReading"]["metrics"]["humidity"] is not None
    assert values[":recentReadings"][0]["readingId"] == values[":lastReading"]["readingId"]
    assert values[":recentReadings"][1]["readingId"] == "old"
    assert values[":online"] == "ONLINE"
    assert "#status = :online" in fake_table.update_kwargs[0]["UpdateExpression"]


def test_write_telemetry_keeps_offline_devices_offline(monkeypatch: Any) -> None:
    device_id = "dev-offline"
    device_item = {
        "PK": "HUB#demo",
        "SK": f"DEVICE#{device_id}",
        "deviceId": device_id,
        "name": "Basement",
        "type": "heat-alarm",
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
    assert ":online" not in values
    assert "ExpressionAttributeNames" not in fake_table.update_kwargs[0]
    assert values[":lastReading"]["deviceId"] == device_id
