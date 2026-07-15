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

    item: dict[str, Any] = {
        "PK": tenant_pk,
        "SK": f"READING#{device_id}#{recorded_at}#{reading_id}",
        "readingId": reading_id,
        "deviceId": device_id,
        "recordedAt": recorded_at,
        "createdAt": timestamp,
        "alarm": normalized["alarm"],
        "state": normalized["state"],
        "metrics": metrics_to_dynamo(normalized["metrics"]),
    }

    table.put_item(Item=item)

    if not device_item:
        return

    device_status = str(device_item.get("status") or "UNKNOWN")

    if device_status == "OFFLINE":
        table.update_item(
            Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"},
            UpdateExpression="SET lastSeenAt = :lastSeenAt, updatedAt = :updatedAt",
            ExpressionAttributeValues={
                ":lastSeenAt": recorded_at,
                ":updatedAt": timestamp,
            },
        )
    else:
        table.update_item(
            Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"},
            UpdateExpression="SET #status = :online, lastSeenAt = :lastSeenAt, updatedAt = :updatedAt",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":online": "ONLINE",
                ":lastSeenAt": recorded_at,
                ":updatedAt": timestamp,
            },
        )


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    if isinstance(event, str):
        event = json.loads(event)
    write_telemetry(event)
    return {"ok": True}
