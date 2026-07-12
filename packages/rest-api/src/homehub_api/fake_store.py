"""In-memory store for tests and local development only."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from ulid import new as new_ulid

from homehub_api.config import HUMIDITY_ISSUE_THRESHOLD
from homehub_api.errors import ApiError
from homehub_api.models import (
    CommandResponse,
    CreateCommandRequest,
    CreateDeviceRequest,
    CreateIssueRequest,
    CreateReadingRequest,
    CreateReadingResponse,
    DeviceResponse,
    IssueResponse,
    ReadingResponse,
    UpdateDeviceRequest,
    UpdateIssueRequest,
)
from homehub_api.store import humidity_issue_title


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    return str(new_ulid())


class FakeHubStore:
    def __init__(self) -> None:
        self.devices: dict[str, DeviceResponse] = {}
        self.readings: dict[str, list[ReadingResponse]] = {}
        self.commands: dict[str, list[CommandResponse]] = {}
        self.issues: dict[str, IssueResponse] = {}

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

        data = existing.model_dump(by_alias=True)
        data.update(payload.model_dump(exclude_none=True, by_alias=True))
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

    def create_reading(
        self, device_id: str, payload: CreateReadingRequest
    ) -> CreateReadingResponse:
        self._require_device(device_id)
        reading_id = _new_id()
        timestamp = _now_iso()
        reading = ReadingResponse(
            readingId=reading_id,
            deviceId=device_id,
            temperature=payload.temperature,
            humidity=payload.humidity,
            motionDetected=payload.motion_detected,
            cameraOnline=payload.camera_online,
            recordedAt=payload.recorded_at or timestamp,
            createdAt=timestamp,
        )
        self.readings.setdefault(device_id, []).insert(0, reading)
        issue: IssueResponse | None = None

        if payload.humidity is not None and payload.humidity >= HUMIDITY_ISSUE_THRESHOLD:
            open_issues = [
                existing
                for existing in self.issues.values()
                if existing.device_id == device_id and existing.status == "OPEN"
            ]
            if not open_issues:
                issue = self.create_issue(
                    CreateIssueRequest(
                        title=humidity_issue_title(payload.humidity),
                        deviceId=device_id,
                        severity="HIGH",
                        status="OPEN",
                        notes="Automatically raised from a high humidity sensor reading.",
                    )
                )

        return CreateReadingResponse(reading=reading, issue=issue)

    def list_commands(self, device_id: str, limit: int = 50) -> list[CommandResponse]:
        self._require_device(device_id)
        return (self.commands.get(device_id) or [])[:limit]

    def create_command(self, device_id: str, payload: CreateCommandRequest) -> CommandResponse:
        self._require_device(device_id)
        command_id = _new_id()
        timestamp = _now_iso()
        command = CommandResponse(
            commandId=command_id,
            deviceId=device_id,
            command=payload.command,
            status="PENDING",
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        self.commands.setdefault(device_id, []).insert(0, command)
        return command

    def list_issues(self, limit: int = 50) -> list[IssueResponse]:
        return list(self.issues.values())[:limit]

    def get_issue(self, issue_id: str) -> IssueResponse | None:
        return self.issues.get(issue_id)

    def create_issue(self, payload: CreateIssueRequest) -> IssueResponse:
        if payload.device_id:
            self._require_device(payload.device_id)

        issue_id = _new_id()
        timestamp = _now_iso()
        issue = IssueResponse(
            issueId=issue_id,
            title=payload.title,
            deviceId=payload.device_id,
            severity=payload.severity,
            status=payload.status,
            notes=payload.notes,
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        self.issues[issue_id] = issue
        return issue

    def update_issue(self, issue_id: str, payload: UpdateIssueRequest) -> IssueResponse:
        existing = self.get_issue(issue_id)
        if not existing:
            raise ApiError("Issue not found", 404, "NotFound")

        if payload.device_id:
            self._require_device(payload.device_id)

        data = existing.model_dump(by_alias=True)
        data.update(payload.model_dump(exclude_none=True, by_alias=True))
        data["updatedAt"] = _now_iso()
        updated = IssueResponse.model_validate(data)
        self.issues[issue_id] = updated
        return updated

    def _require_device(self, device_id: str) -> DeviceResponse:
        device = self.get_device(device_id)
        if not device:
            raise ApiError("Device not found", 404, "NotFound")
        return device

    def seed_demo_devices(self) -> None:
        if self.devices:
            return

        from homehub_api.demo_seed import DEMO_DEVICES

        for device in DEMO_DEVICES:
            self.devices[device.device_id] = device
