"""Hot-path telemetry writer: IoT Rule → DynamoDB reading + device ONLINE."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import boto3
from ulid import new as new_ulid

from homehub_api.config import DEMO_TENANT_PK, hub_pk_for_user
from homehub_api.telemetry_model import (
    metrics_to_dynamo,
    normalize_telemetry_event,
)

RECENT_READINGS_LIMIT = 10


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    return str(new_ulid())


def _tenant_pk_for_device(table: Any, device_id: str, event: dict[str, Any]) -> str:
    hub_id = event.get("hubId")
    if hub_id:
        return hub_pk_for_user(str(hub_id))

    registry = table.get_item(Key={"PK": "SIMULATOR", "SK": f"DEVICE#{device_id}"}).get("Item")
    if registry and registry.get("tenantPk"):
        return str(registry["tenantPk"])

    result = table.get_item(Key={"PK": DEMO_TENANT_PK, "SK": f"DEVICE#{device_id}"})
    if result.get("Item"):
        return DEMO_TENANT_PK

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

    tenant_pk = _tenant_pk_for_device(table, device_id, event)
    device_item = _device_record(table, tenant_pk, device_id)
    configuration = device_item.get("configuration") if device_item else None
    device_type = (
        str(device_item["type"]) if device_item and device_item.get("type") else None
    )
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

    expression_values: dict[str, Any] = {
        ":lastSeenAt": recorded_at,
        ":updatedAt": timestamp,
        ":lastReading": snapshot,
        ":recentReadings": recent_readings,
    }
    update_parts = [
        "lastSeenAt = :lastSeenAt",
        "updatedAt = :updatedAt",
        "lastReading = :lastReading",
        "recentReadings = :recentReadings",
    ]
    expression_names: dict[str, str] | None = None

    if device_status != "OFFLINE":
        expression_names = {"#status": "status"}
        expression_values[":online"] = "ONLINE"
        update_parts.insert(0, "#status = :online")

    update_kwargs: dict[str, Any] = {
        "Key": {"PK": tenant_pk, "SK": f"DEVICE#{device_id}"},
        "UpdateExpression": "SET " + ", ".join(update_parts),
        "ExpressionAttributeValues": expression_values,
    }
    if expression_names is not None:
        update_kwargs["ExpressionAttributeNames"] = expression_names

    table.update_item(**update_kwargs)


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    if isinstance(event, str):
        event = json.loads(event)
    write_telemetry(event)
    return {"ok": True}
