"""Tests for DynamoDB hub store lifecycle."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from homehub_api.store import HubStore


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
    monkeypatch.delenv("SIMULATOR_QUEUE_URL", raising=False)
    monkeypatch.setattr("homehub_api.store.boto3.resource", lambda _service: resource)

    store = HubStore("test-table", tenant_pk="HUB#user-1")
    store._decommission_device("dev-abc")

    assert fake_table.deleted_keys == [{"PK": "SIMULATOR", "SK": "DEVICE#dev-abc"}]
