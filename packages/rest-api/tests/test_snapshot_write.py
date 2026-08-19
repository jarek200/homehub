"""Tests for physical camera snapshot ingestion."""

from __future__ import annotations

import base64
from typing import Any
from unittest.mock import MagicMock

from homehub_api.iot.snapshot import write_snapshot

JPEG = b"\xff\xd8homehub-camera\xff\xd9"


class _FakeTable:
    def __init__(self, device_type: str = "camera") -> None:
        self.device = {
            "PK": "HUB#owner",
            "SK": "DEVICE#cam-1",
            "deviceId": "cam-1",
            "type": device_type,
            "status": "UNKNOWN",
        }
        self.updates: list[dict[str, Any]] = []

    def get_item(self, Key: dict[str, str]) -> dict[str, Any]:  # noqa: N803
        if Key == {"PK": "SIMULATOR", "SK": "DEVICE#cam-1"}:
            return {"Item": {"tenantPk": "HUB#owner"}}
        if Key == {"PK": "HUB#owner", "SK": "DEVICE#cam-1"}:
            return {"Item": self.device}
        return {}

    def update_item(self, **kwargs: Any) -> None:
        self.updates.append(kwargs)


def _install_aws_fakes(monkeypatch: Any, table: _FakeTable) -> MagicMock:
    dynamodb = MagicMock()
    dynamodb.Table.return_value = table
    s3 = MagicMock()
    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setenv("SNAPSHOT_BUCKET", "test-snapshots")
    monkeypatch.setattr(
        "homehub_api.iot.snapshot.boto3.resource",
        lambda service: dynamodb if service == "dynamodb" else None,
    )
    monkeypatch.setattr(
        "homehub_api.iot.snapshot.boto3.client",
        lambda service: s3 if service == "s3" else None,
    )
    return s3


def test_write_snapshot_uploads_jpeg_and_updates_camera(monkeypatch: Any) -> None:
    table = _FakeTable()
    s3 = _install_aws_fakes(monkeypatch, table)

    assert write_snapshot(
        {
            "deviceId": "cam-1",
            "recordedAt": "2026-08-19T11:30:00Z",
            "imageBase64": base64.b64encode(JPEG).decode(),
        }
    )

    s3.put_object.assert_called_once_with(
        Bucket="test-snapshots",
        Key="snapshots/cam-1/2026-08-19T113000Z.jpg",
        Body=JPEG,
        ContentType="image/jpeg",
    )
    values = table.updates[0]["ExpressionAttributeValues"]
    assert values[":snapshotKey"] == "snapshots/cam-1/2026-08-19T113000Z.jpg"
    assert values[":online"] == "ONLINE"


def test_write_snapshot_rejects_invalid_or_non_camera_payload(monkeypatch: Any) -> None:
    table = _FakeTable(device_type="environmental-sensor")
    s3 = _install_aws_fakes(monkeypatch, table)

    assert not write_snapshot({"deviceId": "cam-1", "imageBase64": "not-base64"})
    assert not write_snapshot(
        {"deviceId": "cam-1", "imageBase64": base64.b64encode(JPEG).decode()}
    )
    s3.put_object.assert_not_called()
    assert table.updates == []
