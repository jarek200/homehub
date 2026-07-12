"""Hot-path telemetry writer: IoT Rule → DynamoDB reading + device ONLINE."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import boto3
from ulid import new as new_ulid

from homehub_api.config import DEMO_TENANT_PK, HUMIDITY_ISSUE_THRESHOLD
from homehub_api.store import humidity_issue_title


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    return str(new_ulid())


def _tenant_pk_for_device(table: Any, device_id: str) -> str:
    result = table.get_item(Key={"PK": DEMO_TENANT_PK, "SK": f"DEVICE#{device_id}"})
    if result.get("Item"):
        return DEMO_TENANT_PK
    return DEMO_TENANT_PK


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

    tenant_pk = _tenant_pk_for_device(table, device_id)
    timestamp = _now_iso()
    recorded_at = str(event.get("recordedAt") or timestamp)
    reading_id = _new_id()

    item: dict[str, Any] = {
        "PK": tenant_pk,
        "SK": f"READING#{device_id}#{recorded_at}#{reading_id}",
        "readingId": reading_id,
        "deviceId": device_id,
        "recordedAt": recorded_at,
        "createdAt": timestamp,
    }

    for field in ("temperature", "humidity", "motionDetected", "cameraOnline"):
        if event.get(field) is not None:
            item[field] = event[field]

    table.put_item(Item=item)

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

    humidity = event.get("humidity")
    if humidity is not None and float(humidity) >= HUMIDITY_ISSUE_THRESHOLD:
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
                    "title": humidity_issue_title(float(humidity)),
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
