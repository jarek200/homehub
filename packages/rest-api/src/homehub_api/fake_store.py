"""In-memory store for tests and local development only."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from ulid import new as new_ulid

from homehub_api.config import DEMO_TENANT_PK
from homehub_api.device_configuration import configuration_for_create
from homehub_api.errors import ApiError
from homehub_api.models import (
    CreateDeviceRequest,
    DeviceResponse,
    ReadingResponse,
    UpdateDeviceRequest,
)
from homehub_api.pagination import (
    DeviceListPage,
    decode_device_cursor,
    encode_device_cursor,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    return str(new_ulid())


class FakeHubStore:
    def __init__(self) -> None:
        self.devices: dict[str, DeviceResponse] = {}
        self.readings: dict[str, list[ReadingResponse]] = {}

    def list_devices(self, *, limit: int = 50, cursor: str | None = None) -> DeviceListPage:
        sorted_devices = sorted(self.devices.values(), key=lambda device: device.device_id)
        start_idx = 0
        if cursor:
            key = decode_device_cursor(cursor)
            after_id = key["SK"].removeprefix("DEVICE#")
            for index, device in enumerate(sorted_devices):
                if device.device_id == after_id:
                    start_idx = index + 1
                    break

        page = sorted_devices[start_idx : start_idx + limit]
        next_cursor = None
        if start_idx + limit < len(sorted_devices) and page:
            last = page[-1]
            next_cursor = encode_device_cursor(
                {"PK": DEMO_TENANT_PK, "SK": f"DEVICE#{last.device_id}"}
            )
        return DeviceListPage(items=page, next_cursor=next_cursor)

    def get_device(self, device_id: str) -> DeviceResponse | None:
        return self.devices.get(device_id)

    def create_device(self, payload: CreateDeviceRequest) -> DeviceResponse:
        device_id = _new_id()
        timestamp = _now_iso()
        device = DeviceResponse(
            deviceId=device_id,
            name=payload.name,
            type=payload.type,
            location=payload.location,
            runtimeKind=payload.runtime_kind,
            status="UNKNOWN",
            lifecycleStatus="PROVISIONING",
            configuration=configuration_for_create(
                payload.type,
                payload.configuration,
                runtime_kind=payload.runtime_kind,
            ),
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        self.devices[device_id] = device
        return device

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

        data = existing.model_dump(by_alias=True)
        data.update(updates)
        data["updatedAt"] = _now_iso()
        updated = DeviceResponse.model_validate(data)
        self.devices[device_id] = updated
        return updated

    def delete_device(self, device_id: str) -> dict[str, Any]:
        if device_id not in self.devices:
            raise ApiError("Device not found", 404, "NotFound")
        del self.devices[device_id]
        return {"deleted": True, "deviceId": device_id}

    def list_readings(self, device_id: str, limit: int = 50) -> list[ReadingResponse]:
        self._require_device(device_id)
        return (self.readings.get(device_id) or [])[:limit]

    def _require_device(self, device_id: str) -> DeviceResponse:
        device = self.get_device(device_id)
        if not device:
            raise ApiError("Device not found", 404, "NotFound")
        return device
