"""Hot-path telemetry writer: IoT Rule → DynamoDB reading + device ONLINE."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import boto3
from ulid import new as new_ulid

from homehub_api.config import DEMO_TENANT_PK, hub_pk_for_user
from homehub_api.store import humidity_issue_title
from homehub_api.telemetry_model import (
    metrics_humidity,
    metrics_to_dynamo,
    normalize_telemetry_event,
)
from homehub_api.thresholds import humidity_issue_threshold


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
    configuration = (
        str(device_item["configuration"])
        if device_item and device_item.get("configuration")
        else None
    )
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

    humidity = metrics_humidity(normalized["metrics"])
    humidity_limit = humidity_issue_threshold(configuration)
    if humidity is not None and humidity >= humidity_limit:
        issues = table.query(
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={":pk": tenant_pk, ":sk": "ISSUE#"},
            Limit=100,
        ).get("Items", [])
        open_for_device = [
            issue
            for issue in issues
            if issue.get("deviceId") == device_id and issue.get("status") == "OPEN"
        ]
        if not open_for_device:
            issue_id = _new_id()
            table.put_item(
                Item={
                    "PK": tenant_pk,
                    "SK": f"ISSUE#{issue_id}",
                    "issueId": issue_id,
                    "title": humidity_issue_title(humidity),
                    "deviceId": device_id,
                    "severity": "HIGH",
                    "status": "OPEN",
                    "notes": "Automatically raised from a high humidity sensor reading.",
                    "createdAt": timestamp,
                    "updatedAt": timestamp,
                    "GSI1PK": tenant_pk,
                    "GSI1SK": f"ISSUE#{timestamp}",
                }
            )


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    if isinstance(event, str):
        event = json.loads(event)
    write_telemetry(event)
    return {"ok": True}
