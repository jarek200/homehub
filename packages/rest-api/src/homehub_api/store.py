from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

import boto3
from ulid import new as new_ulid

from homehub_api.config import DEMO_TENANT_PK
from homehub_api.device_configuration import as_config_json
from homehub_api.errors import ApiError
from homehub_api.models import (
    CreateDeviceRequest,
    DeviceResponse,
    ReadingResponse,
    UpdateDeviceRequest,
)
from homehub_api.telemetry_model import reading_from_dynamo


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


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
        # Prefer explicit lastReading when present; keep recent list as stored.
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

    return DeviceResponse(
        deviceId=device_id,
        name=str(item["name"]),
        type=device_type,
        location=item.get("location"),
        status=item.get("status", "UNKNOWN"),
        lifecycleStatus=item.get("lifecycleStatus", "READY"),
        thingName=item.get("thingName"),
        certificateId=item.get("certificateId"),
        failureReason=item.get("failureReason"),
        configuration=configuration,
        lastSeenAt=item.get("lastSeenAt"),
        lastReading=last_reading,
        recentReadings=recent_readings,
        createdAt=str(item["createdAt"]),
        updatedAt=str(item["updatedAt"]),
    )


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


def _safe_to_device(item: dict[str, Any]) -> DeviceResponse | None:
    try:
        return _to_device(item)
    except (KeyError, ValueError):
        return None


class HubStore:
    def __init__(self, table_name: str, tenant_pk: str = DEMO_TENANT_PK):
        self.table_name = table_name
        self.tenant_pk = tenant_pk
        self._table = boto3.resource("dynamodb").Table(table_name)

    def list_devices(self, limit: int = 50) -> list[DeviceResponse]:
        result = self._table.query(
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={":pk": self.tenant_pk, ":sk": "DEVICE#"},
            Limit=limit,
        )
        devices: list[DeviceResponse] = []
        for item in result.get("Items", []):
            device = _safe_to_device(item)
            if device is not None:
                devices.append(device)
        return devices

    def get_device(self, device_id: str) -> DeviceResponse | None:
        result = self._table.get_item(Key={"PK": self.tenant_pk, "SK": f"DEVICE#{device_id}"})
        item = result.get("Item")
        return _safe_to_device(item) if item else None

    def create_device(self, payload: CreateDeviceRequest) -> DeviceResponse:
        device_id = _new_id()
        timestamp = _now_iso()
        item = {
            "PK": self.tenant_pk,
            "SK": f"DEVICE#{device_id}",
            "deviceId": device_id,
            "name": payload.name,
            "type": payload.type,
            "location": payload.location,
            "configuration": as_config_json(payload.configuration),
            "status": "UNKNOWN",
            "lifecycleStatus": "PROVISIONING",
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
        self._table.put_item(Item=item)
        return _to_device(item)

    def update_device(self, device_id: str, payload: UpdateDeviceRequest) -> DeviceResponse:
        existing = self.get_device(device_id)
        if not existing:
            raise ApiError("Device not found", 404, "NotFound")

        updates = payload.model_dump(exclude_none=True, by_alias=True)
        if not updates:
            raise ApiError("At least one field is required", 400, "ValidationError")

        if payload.type is not None and payload.type != existing.type:
            raise ApiError(
                "Device type cannot be changed after registration",
                400,
                "ValidationError",
            )
        updates.pop("type", None)

        if "configuration" in updates:
            updates["configuration"] = as_config_json(payload.configuration)

        expression_names: dict[str, str] = {}
        expression_values: dict[str, Any] = {}
        set_parts: list[str] = []

        for field, value in updates.items():
            expression_names[f"#{field}"] = field
            expression_values[f":{field}"] = value
            set_parts.append(f"#{field} = :{field}")

        updated_at = _now_iso()
        expression_names["#updatedAt"] = "updatedAt"
        expression_values[":updatedAt"] = updated_at
        set_parts.append("#updatedAt = :updatedAt")

        result = self._table.update_item(
            Key={"PK": self.tenant_pk, "SK": f"DEVICE#{device_id}"},
            UpdateExpression="SET " + ", ".join(set_parts),
            ExpressionAttributeNames=expression_names,
            ExpressionAttributeValues=expression_values,
            ReturnValues="ALL_NEW",
        )
        updated = _to_device(result["Attributes"])
        if payload.status is not None and payload.status != existing.status:
            self._notify_simulator_power(device_id, payload.status)
        if (
            payload.configuration is not None
            and as_config_json(payload.configuration) != as_config_json(existing.configuration)
            and updated.lifecycle_status == "READY"
        ):
            self._push_device_shadow_configuration(updated)
        return updated

    def _push_device_shadow_configuration(self, device: DeviceResponse) -> None:
        from homehub_api.iot.shadow import push_device_shadow_desired

        push_device_shadow_desired(
            device_id=device.device_id,
            device_type=device.type,
            configuration=as_config_json(device.configuration),
            thing_name=device.thing_name,
        )

    def _notify_simulator_power(self, device_id: str, status: str) -> None:
        queue_url = os.environ.get("SIMULATOR_QUEUE_URL", "").strip()
        if not queue_url:
            return
        if status == "OFFLINE":
            event_type = "DEVICE_STOP"
        elif status == "ONLINE":
            event_type = "DEVICE_READY"
        else:
            return
        boto3.client("sqs").send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({"eventType": event_type, "deviceId": device_id}),
        )

    def delete_device(self, device_id: str) -> dict[str, Any]:
        device = self.get_device(device_id)
        if not device:
            raise ApiError("Device not found", 404, "NotFound")

        from homehub_api.iot.decommission import decommission_device_resources

        decommission_device_resources(
            device_id=device_id,
            certificate_id=device.certificate_id,
            thing_name=device.thing_name,
        )
        self._decommission_device(device_id)
        self._table.delete_item(Key={"PK": self.tenant_pk, "SK": f"DEVICE#{device_id}"})
        return {"deleted": True, "deviceId": device_id}

    def _decommission_device(self, device_id: str) -> None:
        queue_url = os.environ.get("SIMULATOR_QUEUE_URL", "").strip()
        if queue_url:
            boto3.client("sqs").send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps({"eventType": "DEVICE_STOP", "deviceId": device_id}),
            )
        try:
            self._table.delete_item(Key={"PK": "SIMULATOR", "SK": f"DEVICE#{device_id}"})
        except Exception:
            pass

    def list_readings(self, device_id: str, limit: int = 50) -> list[ReadingResponse]:
        device = self._require_device(device_id)
        result = self._table.query(
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": self.tenant_pk,
                ":sk": f"READING#{device_id}#",
            },
            ScanIndexForward=False,
            Limit=limit,
        )
        return [
            _to_reading(
                item,
                configuration=device.configuration,
                device_type=device.type,
            )
            for item in result.get("Items", [])
        ]

    def get_profile(self, user_id: str) -> dict[str, Any] | None:
        result = self._table.get_item(Key={"PK": f"USER#{user_id}", "SK": "PROFILE"})
        return result.get("Item")

    def _require_device(self, device_id: str) -> DeviceResponse:
        device = self.get_device(device_id)
        if not device:
            raise ApiError("Device not found", 404, "NotFound")
        return device


def build_store(table_name: str) -> HubStore:
    return HubStore(table_name)
