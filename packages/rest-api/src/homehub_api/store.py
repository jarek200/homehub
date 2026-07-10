from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

import boto3
from ulid import new as new_ulid

from homehub_api.config import DEMO_TENANT_PK, HUMIDITY_ISSUE_THRESHOLD
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


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    return str(new_ulid())


def humidity_issue_title(humidity: float) -> str:
    return f"High humidity detected ({humidity:.1f}%)"


def _to_device(item: dict[str, Any]) -> DeviceResponse:
    return DeviceResponse(
        deviceId=str(item["deviceId"]),
        name=str(item["name"]),
        type=str(item["type"]),
        location=item.get("location"),
        status=item.get("status", "UNKNOWN"),
        configuration=item.get("configuration"),
        lastSeenAt=item.get("lastSeenAt"),
        createdAt=str(item["createdAt"]),
        updatedAt=str(item["updatedAt"]),
    )


def _to_reading(item: dict[str, Any]) -> ReadingResponse:
    return ReadingResponse(
        readingId=str(item["readingId"]),
        deviceId=str(item["deviceId"]),
        temperature=item.get("temperature"),
        humidity=item.get("humidity"),
        motionDetected=item.get("motionDetected"),
        cameraOnline=item.get("cameraOnline"),
        recordedAt=str(item["recordedAt"]),
        createdAt=str(item["createdAt"]),
    )


def _to_command(item: dict[str, Any]) -> CommandResponse:
    return CommandResponse(
        commandId=str(item["commandId"]),
        deviceId=str(item["deviceId"]),
        command=str(item["command"]),
        status=item.get("status", "PENDING"),
        result=item.get("result"),
        createdAt=str(item["createdAt"]),
        updatedAt=str(item["updatedAt"]),
    )


def _to_issue(item: dict[str, Any]) -> IssueResponse:
    return IssueResponse(
        issueId=str(item["issueId"]),
        title=str(item["title"]),
        deviceId=item.get("deviceId"),
        severity=item.get("severity", "MEDIUM"),
        status=item.get("status", "OPEN"),
        notes=item.get("notes"),
        createdAt=str(item["createdAt"]),
        updatedAt=str(item["updatedAt"]),
    )


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
        return [_to_device(item) for item in result.get("Items", [])]

    def get_device(self, device_id: str) -> DeviceResponse | None:
        result = self._table.get_item(Key={"PK": self.tenant_pk, "SK": f"DEVICE#{device_id}"})
        item = result.get("Item")
        return _to_device(item) if item else None

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
            "configuration": payload.configuration,
            "status": "UNKNOWN",
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "GSI1PK": self.tenant_pk,
            "GSI1SK": f"DEVICE#{timestamp}",
        }
        self._table.put_item(Item=item)
        return _to_device(item)

    def update_device(self, device_id: str, payload: UpdateDeviceRequest) -> DeviceResponse:
        if not self.get_device(device_id):
            raise ApiError("Device not found", 404, "NotFound")

        updates = payload.model_dump(exclude_none=True, by_alias=True)
        if not updates:
            raise ApiError("At least one field is required", 400, "ValidationError")

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
        return _to_device(result["Attributes"])

    def delete_device(self, device_id: str) -> dict[str, Any]:
        if not self.get_device(device_id):
            raise ApiError("Device not found", 404, "NotFound")
        self._table.delete_item(Key={"PK": self.tenant_pk, "SK": f"DEVICE#{device_id}"})
        return {"deleted": True, "deviceId": device_id}

    def list_readings(self, device_id: str, limit: int = 50) -> list[ReadingResponse]:
        self._require_device(device_id)
        result = self._table.query(
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": self.tenant_pk,
                ":sk": f"READING#{device_id}#",
            },
            ScanIndexForward=False,
            Limit=limit,
        )
        return [_to_reading(item) for item in result.get("Items", [])]

    def create_reading(
        self, device_id: str, payload: CreateReadingRequest
    ) -> CreateReadingResponse:
        self._require_device(device_id)
        reading_id = _new_id()
        timestamp = _now_iso()
        recorded_at = payload.recorded_at or timestamp

        item: dict[str, Any] = {
            "PK": self.tenant_pk,
            "SK": f"READING#{device_id}#{recorded_at}#{reading_id}",
            "readingId": reading_id,
            "deviceId": device_id,
            "recordedAt": recorded_at,
            "createdAt": timestamp,
        }
        if payload.temperature is not None:
            item["temperature"] = payload.temperature
        if payload.humidity is not None:
            item["humidity"] = payload.humidity
        if payload.motion_detected is not None:
            item["motionDetected"] = payload.motion_detected
        if payload.camera_online is not None:
            item["cameraOnline"] = payload.camera_online

        self._table.put_item(Item=item)
        reading = _to_reading(item)
        issue: IssueResponse | None = None

        if payload.humidity is not None and payload.humidity >= HUMIDITY_ISSUE_THRESHOLD:
            open_issues = [
                existing
                for existing in self.list_issues(100)
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
        result = self._table.query(
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": self.tenant_pk,
                ":sk": f"COMMAND#{device_id}#",
            },
            ScanIndexForward=False,
            Limit=limit,
        )
        return [_to_command(item) for item in result.get("Items", [])]

    def create_command(self, device_id: str, payload: CreateCommandRequest) -> CommandResponse:
        self._require_device(device_id)
        command_id = _new_id()
        timestamp = _now_iso()
        item = {
            "PK": self.tenant_pk,
            "SK": f"COMMAND#{device_id}#{timestamp}#{command_id}",
            "commandId": command_id,
            "deviceId": device_id,
            "command": payload.command,
            "status": "PENDING",
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
        self._table.put_item(Item=item)
        return _to_command(item)

    def list_issues(self, limit: int = 50) -> list[IssueResponse]:
        result = self._table.query(
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={":pk": self.tenant_pk, ":sk": "ISSUE#"},
            ScanIndexForward=False,
            Limit=limit,
        )
        return [_to_issue(item) for item in result.get("Items", [])]

    def get_issue(self, issue_id: str) -> IssueResponse | None:
        result = self._table.get_item(Key={"PK": self.tenant_pk, "SK": f"ISSUE#{issue_id}"})
        item = result.get("Item")
        return _to_issue(item) if item else None

    def create_issue(self, payload: CreateIssueRequest) -> IssueResponse:
        if payload.device_id:
            self._require_device(payload.device_id)

        issue_id = _new_id()
        timestamp = _now_iso()
        item = {
            "PK": self.tenant_pk,
            "SK": f"ISSUE#{issue_id}",
            "issueId": issue_id,
            "title": payload.title,
            "deviceId": payload.device_id,
            "severity": payload.severity,
            "status": payload.status,
            "notes": payload.notes,
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "GSI1PK": self.tenant_pk,
            "GSI1SK": f"ISSUE#{timestamp}",
        }
        self._table.put_item(Item=item)
        return _to_issue(item)

    def update_issue(self, issue_id: str, payload: UpdateIssueRequest) -> IssueResponse:
        if not self.get_issue(issue_id):
            raise ApiError("Issue not found", 404, "NotFound")

        if payload.device_id:
            self._require_device(payload.device_id)

        updates = payload.model_dump(exclude_none=True, by_alias=True)
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
            Key={"PK": self.tenant_pk, "SK": f"ISSUE#{issue_id}"},
            UpdateExpression="SET " + ", ".join(set_parts),
            ExpressionAttributeNames=expression_names,
            ExpressionAttributeValues=expression_values,
            ReturnValues="ALL_NEW",
        )
        return _to_issue(result["Attributes"])

    def _require_device(self, device_id: str) -> DeviceResponse:
        device = self.get_device(device_id)
        if not device:
            raise ApiError("Device not found", 404, "NotFound")
        return device


def build_store(table_name: str) -> HubStore:
    return HubStore(table_name)
