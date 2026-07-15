from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

import boto3
from ulid import new as new_ulid

from homehub_api.config import DEMO_TENANT_PK
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
from homehub_api.telemetry_model import (
    metrics_humidity,
    metrics_to_dynamo,
    normalize_telemetry_event,
    reading_from_dynamo,
)
from homehub_api.thresholds import humidity_issue_threshold


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    return str(new_ulid())


def humidity_issue_title(humidity: float) -> str:
    return f"High humidity detected ({humidity:.1f}%)"


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
    return DeviceResponse(
        deviceId=_device_id_from_item(item),
        name=str(item["name"]),
        type=str(item["type"]),
        location=item.get("location"),
        status=item.get("status", "UNKNOWN"),
        lifecycleStatus=item.get("lifecycleStatus", "READY"),
        thingName=item.get("thingName"),
        certificateId=item.get("certificateId"),
        failureReason=item.get("failureReason"),
        configuration=item.get("configuration"),
        lastSeenAt=item.get("lastSeenAt"),
        createdAt=str(item["createdAt"]),
        updatedAt=str(item["updatedAt"]),
    )


def _to_reading(
    item: dict[str, Any],
    *,
    configuration: str | None = None,
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
            "configuration": payload.configuration,
            "status": "UNKNOWN",
            "lifecycleStatus": "PROVISIONING",
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "GSI1PK": self.tenant_pk,
            "GSI1SK": f"DEVICE#{timestamp}",
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
            and payload.configuration != existing.configuration
            and updated.lifecycle_status == "READY"
        ):
            self._push_device_shadow_configuration(updated)
        return updated

    def _push_device_shadow_configuration(self, device: DeviceResponse) -> None:
        from homehub_api.iot.shadow import push_device_shadow_desired

        push_device_shadow_desired(
            device_id=device.device_id,
            device_type=device.type,
            configuration=device.configuration,
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
        timestamp = _now_iso()
        try:
            self._table.update_item(
                Key={"PK": "SIMULATOR", "SK": f"DEVICE#{device_id}"},
                UpdateExpression="SET enabled = :enabled, #status = :status, updatedAt = :updatedAt",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":enabled": False,
                    ":status": "STOPPED",
                    ":updatedAt": timestamp,
                },
            )
        except Exception:
            pass
        queue_url = os.environ.get("SIMULATOR_QUEUE_URL", "").strip()
        if queue_url:
            boto3.client("sqs").send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps({"eventType": "DEVICE_STOP", "deviceId": device_id}),
            )

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

    def create_reading(
        self, device_id: str, payload: CreateReadingRequest
    ) -> CreateReadingResponse:
        device = self._require_device(device_id)
        reading_id = _new_id()
        timestamp = _now_iso()
        recorded_at = payload.recorded_at or timestamp

        normalized = normalize_telemetry_event(
            payload.model_dump(by_alias=True, exclude_none=True),
            configuration=device.configuration,
            device_type=device.type,
        )

        item: dict[str, Any] = {
            "PK": self.tenant_pk,
            "SK": f"READING#{device_id}#{recorded_at}#{reading_id}",
            "readingId": reading_id,
            "deviceId": device_id,
            "recordedAt": recorded_at,
            "createdAt": timestamp,
            "alarm": normalized["alarm"],
            "state": normalized["state"],
            "metrics": metrics_to_dynamo(normalized["metrics"]),
        }

        self._table.put_item(Item=item)
        reading = _to_reading(
            item,
            configuration=device.configuration,
            device_type=device.type,
        )
        issue: IssueResponse | None = None

        humidity = metrics_humidity(normalized["metrics"])
        humidity_limit = humidity_issue_threshold(device.configuration)
        if humidity is not None and humidity >= humidity_limit:
            open_issues = [
                existing
                for existing in self.list_issues(100)
                if existing.device_id == device_id and existing.status == "OPEN"
            ]
            if not open_issues:
                issue = self.create_issue(
                    CreateIssueRequest(
                        title=humidity_issue_title(humidity),
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

    def get_profile(self, user_id: str) -> dict[str, Any] | None:
        result = self._table.get_item(Key={"PK": f"USER#{user_id}", "SK": "PROFILE"})
        return result.get("Item")

    def update_profile(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.get_profile(user_id)
        if not existing:
            raise ApiError("User profile not found", 404, "NotFound")

        expression_names: dict[str, str] = {}
        expression_values: dict[str, Any] = {}
        set_parts: list[str] = []

        for field, value in payload.items():
            expression_names[f"#{field}"] = field
            expression_values[f":{field}"] = value
            set_parts.append(f"#{field} = :{field}")

        updated_at = _now_iso()
        expression_names["#updatedAt"] = "updatedAt"
        expression_values[":updatedAt"] = updated_at
        set_parts.append("#updatedAt = :updatedAt")

        result = self._table.update_item(
            Key={"PK": f"USER#{user_id}", "SK": "PROFILE"},
            UpdateExpression="SET " + ", ".join(set_parts),
            ExpressionAttributeNames=expression_names,
            ExpressionAttributeValues=expression_values,
            ReturnValues="ALL_NEW",
        )
        return result["Attributes"]

    def _require_device(self, device_id: str) -> DeviceResponse:
        device = self.get_device(device_id)
        if not device:
            raise ApiError("Device not found", 404, "NotFound")
        return device


def build_store(table_name: str) -> HubStore:
    return HubStore(table_name)
