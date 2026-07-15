"""In-memory store for tests and local development only."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from ulid import new as new_ulid

from homehub_api.errors import ApiError
from homehub_api.models import (
    CreateDeviceRequest,
    DeviceResponse,
    ReadingResponse,
    UpdateDeviceRequest,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    return str(new_ulid())


class FakeHubStore:
    def __init__(self) -> None:
        self.devices: dict[str, DeviceResponse] = {}
        self.readings: dict[str, list[ReadingResponse]] = {}

    def list_devices(self, limit: int = 50) -> list[DeviceResponse]:
        return list(self.devices.values())[:limit]

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
            status="UNKNOWN",
            lifecycleStatus="PROVISIONING",
            configuration=payload.configuration,
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
