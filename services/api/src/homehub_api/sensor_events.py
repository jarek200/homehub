"""Durable OPEN / DETECTED events. No TTL — kept for years on the household partition."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from homehub_api.errors import ApiError
from homehub_api.household import now_iso
from homehub_api.sensor_history import collect_durable_events

EVENT_SK_PREFIX = "EVENT#"
SENSOR_EVENT_MAX_SPAN = timedelta(days=800)
SENSOR_EVENT_LIST_LIMIT = 200
SENSOR_EVENT_LIST_MAX = 2000


def event_sk(at: str, kind: str, device_id: str) -> str:
    return f"{EVENT_SK_PREFIX}{at}#{kind}#{device_id}"


def event_range_sk(bound: str) -> str:
    return f"{EVENT_SK_PREFIX}{bound}"


def build_event_item(
    tenant_pk: str, event: dict[str, str], *, created_at: str | None = None
) -> dict[str, Any]:
    at = str(event["at"])
    kind = str(event["kind"])
    device_id = str(event["deviceId"])
    return {
        "PK": tenant_pk,
        "SK": event_sk(at, kind, device_id),
        "itemType": "SENSOR_EVENT",
        "deviceId": device_id,
        "name": str(event.get("name") or device_id),
        "kind": kind,
        "value": str(event["value"]),
        "at": at,
        "createdAt": created_at or now_iso(),
    }


def event_from_item(item: dict[str, Any]) -> dict[str, str]:
    return {
        "deviceId": str(item.get("deviceId") or ""),
        "name": str(item.get("name") or item.get("deviceId") or ""),
        "kind": str(item.get("kind") or ""),
        "value": str(item.get("value") or ""),
        "at": str(item.get("at") or ""),
    }


def write_sensor_events(table: Any, tenant_pk: str, events: list[dict[str, str]]) -> int:
    written = 0
    for event in events:
        table.put_item(Item=build_event_item(tenant_pk, event))
        written += 1
    return written


def persist_durable_events(
    table: Any,
    tenant_pk: str,
    previous: dict[str, Any] | None,
    current: dict[str, Any] | None,
    recorded_at: str,
) -> int:
    return write_sensor_events(
        table, tenant_pk, collect_durable_events(previous, current, recorded_at)
    )


def iso_bound(stamp: datetime) -> str:
    return stamp.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def validate_event_window(*, start: datetime, end: datetime) -> None:
    if start >= end:
        raise ApiError("'from' must be earlier than 'to'", 400, "ValidationError")
    if end - start > SENSOR_EVENT_MAX_SPAN:
        raise ApiError("Sensor event range cannot exceed 800 days", 400, "ValidationError")
