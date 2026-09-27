from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from boto3.dynamodb.types import TypeSerializer
from ulid import new as new_ulid

from homehub_api.household import now_iso
from homehub_api.models import DeviceResponse, ReadingResponse
from homehub_api.telemetry_model import reading_from_dynamo

_serializer = TypeSerializer()


def _now_iso() -> str:
    return now_iso()


def _low_level_item(item: dict[str, Any]) -> dict[str, Any]:
    return {key: _serializer.serialize(value) for key, value in item.items() if value is not None}


def _new_id() -> str:
    return str(new_ulid())


def _device_id_from_item(item: dict[str, Any]) -> str:
    device_id = item.get("deviceId")
    if device_id:
        return str(device_id)
    sk = str(item.get("SK", ""))
    if sk.startswith("DEVICE#"):
        return sk.removeprefix("DEVICE#")
    raise KeyError("deviceId")


def _is_complete_device(item: dict[str, Any]) -> bool:
    return all(key in item for key in ("name", "type", "createdAt", "updatedAt"))


def _to_reading(
    item: dict[str, Any],
    *,
    configuration: Any = None,
    device_type: str | None = None,
) -> ReadingResponse:
    normalized = reading_from_dynamo(
        item,
        configuration=configuration,
        device_type=device_type,
    )
    return ReadingResponse(
        readingId=str(item["readingId"]),
        deviceId=str(item["deviceId"]),
        alarm=normalized["alarm"],
        state=normalized["state"],
        metrics=normalized["metrics"],
        recordedAt=str(item["recordedAt"]),
        createdAt=str(item["createdAt"]),
    )


def _to_device(item: dict[str, Any]) -> DeviceResponse:
    if not _is_complete_device(item):
        raise ValueError("Incomplete device record")

    device_id = _device_id_from_item(item)
    device_type = str(item["type"])
    configuration = item.get("configuration")

    recent_raw = item.get("recentReadings")
    recent_items: list[dict[str, Any]] = []
    if isinstance(recent_raw, list):
        recent_items = [entry for entry in recent_raw if isinstance(entry, dict)]

    last_raw = item.get("lastReading")
    if isinstance(last_raw, dict) and not recent_items:
        recent_items = [last_raw]
    elif isinstance(last_raw, dict) and recent_items:
        pass

    recent_readings = [
        _to_reading(
            {**entry, "deviceId": entry.get("deviceId") or device_id},
            configuration=configuration,
            device_type=device_type,
        )
        for entry in recent_items
        if entry.get("readingId") and entry.get("recordedAt") and entry.get("createdAt")
    ]

    last_reading: ReadingResponse | None = None
    if isinstance(last_raw, dict) and last_raw.get("readingId"):
        try:
            last_reading = _to_reading(
                {**last_raw, "deviceId": last_raw.get("deviceId") or device_id},
                configuration=configuration,
                device_type=device_type,
            )
        except (KeyError, TypeError, ValueError):
            last_reading = None
    if last_reading is None and recent_readings:
        last_reading = recent_readings[0]

    status = item.get("status", "UNKNOWN")
    last_seen_at = item.get("lastSeenAt")
    if (
        device_type == "camera"
        and item.get("runtimeKind") == "physical"
        and status == "ONLINE"
        and isinstance(last_seen_at, str)
    ):
        try:
            seen = datetime.fromisoformat(last_seen_at.replace("Z", "+00:00"))
            if seen.tzinfo is None:
                seen = seen.replace(tzinfo=UTC)
            if datetime.now(UTC) - seen > timedelta(minutes=3):
                status = "OFFLINE"
        except ValueError:
            status = "OFFLINE"

    return DeviceResponse(
        deviceId=device_id,
        name=str(item["name"]),
        type=device_type,
        location=item.get("location"),
        runtimeKind=item.get("runtimeKind", "simulated"),
        gatewayId=item.get("gatewayId"),
        nodeId=int(item["nodeId"]) if item.get("nodeId") is not None else None,
        endpoint=int(item["endpoint"]) if item.get("endpoint") is not None else None,
        clusters=list(item["clusters"]) if isinstance(item.get("clusters"), list) else None,
        status=status,
        lifecycleStatus=item.get("lifecycleStatus", "READY"),
        thingName=item.get("thingName"),
        certificateId=item.get("certificateId"),
        failureReason=item.get("failureReason"),
        configuration=configuration,
        lastSeenAt=last_seen_at,
        lastSnapshotKey=item.get("lastSnapshotKey"),
        lastSnapshotAt=item.get("lastSnapshotAt"),
        lastReading=last_reading,
        recentReadings=recent_readings,
        createdAt=str(item["createdAt"]),
        updatedAt=str(item["updatedAt"]),
    )


def _safe_to_device(item: dict[str, Any]) -> DeviceResponse | None:
    try:
        return _to_device(item)
    except (KeyError, ValueError):
        return None
