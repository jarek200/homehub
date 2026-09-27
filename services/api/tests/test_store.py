"""Tests for DynamoDB hub store lifecycle."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from homehub_api.store import HubStore, _to_device


class _FakeTable:
    def __init__(self) -> None:
        self.deleted_keys: list[dict[str, str]] = []

    def delete_item(self, Key: dict[str, str]) -> None:  # noqa: N803
        self.deleted_keys.append(Key)


def test_decommission_device_deletes_simulator_registry(monkeypatch: Any) -> None:
    fake_table = _FakeTable()
    resource = MagicMock()
    resource.Table.return_value = fake_table
    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setattr("homehub_api.store.boto3.resource", lambda _service: resource)

    store = HubStore("test-table", tenant_pk="HUB#user-1")
    store._decommission_device("dev-abc")

    assert fake_table.deleted_keys == [
        {"PK": "DEVICE_REGISTRY", "SK": "DEVICE#dev-abc"},
        {"PK": "SIMULATOR", "SK": "DEVICE#dev-abc"},
    ]


def test_stale_physical_camera_is_reported_offline() -> None:
    device = _to_device(
        {
            "PK": "HOUSEHOLD#family",
            "SK": "DEVICE#cam-1",
            "deviceId": "cam-1",
            "name": "Timer Camera F",
            "type": "camera",
            "runtimeKind": "physical",
            "status": "ONLINE",
            "lastSeenAt": "2020-01-01T00:00:00Z",
            "createdAt": "2020-01-01T00:00:00Z",
            "updatedAt": "2020-01-01T00:00:00Z",
        }
    )
    assert device.status == "OFFLINE"
