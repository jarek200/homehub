"""Physical camera snapshot writer: IoT Rule → S3 + device snapshot metadata."""

from __future__ import annotations

import base64
import binascii
import os
from datetime import UTC, datetime
from typing import Any

import boto3

from homehub_api.iot.telemetry import _device_record, _tenant_pk_for_device

MAX_JPEG_BYTES = 96 * 1024


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _recorded_at(value: Any) -> str:
    raw = str(value or "").strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return _now_iso()
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _snapshot_key(device_id: str, recorded_at: str) -> str:
    stamp = recorded_at.replace(":", "").replace("+00:00", "Z")
    return f"snapshots/{device_id}/{stamp}.jpg"


def _decode_jpeg(value: Any) -> bytes | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        jpeg = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        return None
    if (
        not jpeg
        or len(jpeg) > MAX_JPEG_BYTES
        or not jpeg.startswith(b"\xff\xd8")
        or not jpeg.endswith(b"\xff\xd9")
    ):
        return None
    return jpeg


def write_snapshot(event: dict[str, Any]) -> bool:
    device_id = str(event.get("deviceId") or "").strip()
    jpeg = _decode_jpeg(event.get("imageBase64"))
    if not device_id or jpeg is None:
        return False

    table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
    tenant_pk = _tenant_pk_for_device(table, device_id, event)
    device_item = _device_record(table, tenant_pk, device_id)
    if not device_item or str(device_item.get("type") or "") != "camera":
        return False

    recorded_at = _recorded_at(event.get("recordedAt"))
    key = _snapshot_key(device_id, recorded_at)
    boto3.client("s3").put_object(
        Bucket=os.environ["SNAPSHOT_BUCKET"],
        Key=key,
        Body=jpeg,
        ContentType="image/jpeg",
    )

    updated_at = _now_iso()
    values: dict[str, Any] = {
        ":snapshotKey": key,
        ":snapshotAt": recorded_at,
        ":lastSeenAt": recorded_at,
        ":updatedAt": updated_at,
    }
    update_parts = [
        "lastSnapshotKey = :snapshotKey",
        "lastSnapshotAt = :snapshotAt",
        "lastSeenAt = :lastSeenAt",
        "updatedAt = :updatedAt",
    ]
    names: dict[str, str] | None = None
    if str(device_item.get("status") or "UNKNOWN") != "OFFLINE":
        names = {"#status": "status"}
        values[":online"] = "ONLINE"
        update_parts.insert(0, "#status = :online")

    kwargs: dict[str, Any] = {
        "Key": {"PK": tenant_pk, "SK": f"DEVICE#{device_id}"},
        "UpdateExpression": "SET " + ", ".join(update_parts),
        "ExpressionAttributeValues": values,
    }
    if names:
        kwargs["ExpressionAttributeNames"] = names
    table.update_item(**kwargs)
    return True


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    return {"ok": write_snapshot(event)}
