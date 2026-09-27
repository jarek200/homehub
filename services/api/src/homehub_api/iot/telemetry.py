"""Hot-path telemetry writer: IoT Rule → DynamoDB reading + device ONLINE."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import boto3
from ulid import new as new_ulid

from homehub_api.config import DEMO_TENANT_PK
from homehub_api.dynamo import set_update
from homehub_api.household import normalize_tenant_pk
from homehub_api.household_events import (
    build_camera_snapshot_event,
    build_device_updated_event,
    channel_for_hub_pk,
)
from homehub_api.telemetry_model import (
    metrics_to_dynamo,
    normalize_telemetry_event,
)

RECENT_READINGS_LIMIT = 10
READING_TTL_SECONDS = 3600
SNAPSHOT_TTL_SECONDS = 90 * 24 * 60 * 60


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def reading_expires_at(recorded_at: str | None = None) -> int:
    parsed: datetime | None = None
    if recorded_at:
        try:
            parsed = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
        except ValueError:
            parsed = None
    stamp = parsed or datetime.now(UTC)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return int(stamp.timestamp()) + READING_TTL_SECONDS


def reading_is_live(item: dict[str, Any], *, now: datetime | None = None) -> bool:
    expires_at = item.get("expiresAt")
    if expires_at is None:
        return False
    try:
        deadline = int(expires_at)
    except (TypeError, ValueError):
        return False
    stamp = now or datetime.now(UTC)
    return deadline > int(stamp.timestamp())


def _new_id() -> str:
    return str(new_ulid())


def _tenant_pk_for_device(table: Any, device_id: str, event: dict[str, Any]) -> str:
    from homehub_api.device_registry import get_registry_item

    registry = get_registry_item(table, device_id)
    if registry and registry.get("tenantPk"):
        return normalize_tenant_pk(str(registry["tenantPk"]))

    hub_id = event.get("hubId")
    if hub_id:
        return normalize_tenant_pk(str(hub_id))

    return DEMO_TENANT_PK


def _device_record(table: Any, tenant_pk: str, device_id: str) -> dict[str, Any] | None:
    return table.get_item(Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"}).get("Item")


def _reading_snapshot(
    *,
    reading_id: str,
    device_id: str,
    recorded_at: str,
    created_at: str,
    alarm: bool,
    state: str,
    metrics: dict[str, Any],
) -> dict[str, Any]:
    return {
        "readingId": reading_id,
        "deviceId": device_id,
        "recordedAt": recorded_at,
        "createdAt": created_at,
        "alarm": alarm,
        "state": state,
        "metrics": metrics,
    }


def _next_recent_readings(
    device_item: dict[str, Any],
    snapshot: dict[str, Any],
) -> list[dict[str, Any]]:
    existing = device_item.get("recentReadings")
    prior: list[dict[str, Any]] = []
    if isinstance(existing, list):
        prior = [item for item in existing if isinstance(item, dict)]
    elif isinstance(device_item.get("lastReading"), dict):
        prior = [device_item["lastReading"]]
    return [snapshot, *prior][:RECENT_READINGS_LIMIT]


def write_telemetry(event: dict[str, Any]) -> None:
    table_name = os.environ["TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    device_id = str(event.get("deviceId") or "")
    if not device_id and "topic" in event:
        parts = str(event["topic"]).split("/")
        if len(parts) >= 3:
            device_id = parts[2]

    if not device_id:
        return

    explicit_tenant = event.get("tenantPk")
    if explicit_tenant:
        tenant_pk = normalize_tenant_pk(str(explicit_tenant))
    else:
        tenant_pk = _tenant_pk_for_device(table, device_id, event)
    device_item = _device_record(table, tenant_pk, device_id)
    configuration = device_item.get("configuration") if device_item else None
    device_type = str(device_item["type"]) if device_item and device_item.get("type") else None
    timestamp = _now_iso()
    recorded_at = str(event.get("recordedAt") or timestamp)
    reading_id = _new_id()

    normalized = normalize_telemetry_event(
        event,
        configuration=configuration,
        device_type=device_type,
    )

    metrics = metrics_to_dynamo(normalized["metrics"])
    item: dict[str, Any] = {
        "PK": tenant_pk,
        "SK": f"READING#{device_id}#{recorded_at}#{reading_id}",
        "readingId": reading_id,
        "deviceId": device_id,
        "recordedAt": recorded_at,
        "createdAt": timestamp,
        "alarm": normalized["alarm"],
        "state": normalized["state"],
        "metrics": metrics,
        "expiresAt": reading_expires_at(recorded_at),
    }

    table.put_item(Item=item)

    if not device_item:
        return

    snapshot = _reading_snapshot(
        reading_id=reading_id,
        device_id=device_id,
        recorded_at=recorded_at,
        created_at=timestamp,
        alarm=bool(normalized["alarm"]),
        state=str(normalized["state"]),
        metrics=metrics,
    )
    recent_readings = _next_recent_readings(device_item, snapshot)
    device_status = str(device_item.get("status") or "UNKNOWN")

    fields: dict[str, Any] = {
        "lastSeenAt": recorded_at,
        "updatedAt": timestamp,
        "lastReading": snapshot,
        "recentReadings": recent_readings,
    }

    snapshot_key = event.get("snapshotKey")
    if isinstance(snapshot_key, str) and snapshot_key.strip():
        clean_snapshot_key = snapshot_key.strip()
        fields["lastSnapshotKey"] = clean_snapshot_key
        fields["lastSnapshotAt"] = recorded_at
        table.put_item(
            Item={
                "PK": tenant_pk,
                "SK": f"SNAPSHOT#{device_id}#{recorded_at}#{reading_id}",
                "deviceId": device_id,
                "snapshotKey": clean_snapshot_key,
                "recordedAt": recorded_at,
                "createdAt": timestamp,
                "expiresAt": int(datetime.now(UTC).timestamp()) + SNAPSHOT_TTL_SECONDS,
            }
        )

    if device_status != "OFFLINE":
        fields["status"] = "ONLINE"

    table.update_item(
        Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"},
        **set_update(fields),
    )
    next_status = "OFFLINE" if device_status == "OFFLINE" else "ONLINE"
    if device_type == "camera":
        occupied = metrics.get("occupied") if isinstance(metrics, dict) else None
        _publish_device_updated(
            tenant_pk,
            device_id,
            recorded_at,
            status=next_status,
            occupied=occupied if isinstance(occupied, bool) else None,
        )
    if isinstance(snapshot_key, str) and snapshot_key.strip():
        _publish_camera_snapshot_ready(tenant_pk, device_id, recorded_at)


def _publish_event(tenant_pk: str, payload: dict[str, Any]) -> None:
    if not (os.environ.get("APPSYNC_EVENTS_HTTP_URL") or "").strip():
        return
    channel = channel_for_hub_pk(tenant_pk)
    if not channel:
        return
    try:
        from homehub_api.iot.household_events import publish_household_event

        publish_household_event(channel, payload)
    except Exception:
        return


def _publish_device_updated(
    tenant_pk: str,
    device_id: str,
    recorded_at: str,
    *,
    status: str,
    occupied: bool | None,
) -> None:
    _publish_event(
        tenant_pk,
        build_device_updated_event(
            event_id=f"{device_id}:updated:{recorded_at}",
            device_id=device_id,
            recorded_at=recorded_at,
            status=status,
            occupied=occupied,
        ),
    )


def _publish_camera_snapshot_ready(tenant_pk: str, device_id: str, recorded_at: str) -> None:
    _publish_event(
        tenant_pk,
        build_camera_snapshot_event(
            event_id=f"{device_id}:{recorded_at}",
            device_id=device_id,
            recorded_at=recorded_at,
        ),
    )


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    if isinstance(event, str):
        event = json.loads(event)
    write_telemetry(event)
    return {"ok": True}
