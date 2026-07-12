"""Shared helpers for IoT Step Functions provisioning tasks."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

from homehub_api.config import DEMO_TENANT_PK


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def thing_name_for(device_id: str) -> str:
    return f"homehub-{device_id}"


def ssm_prefix_for(device_id: str) -> str:
    return f"/homehub/devices/{device_id}"


def skip_iot_provisioning() -> bool:
    return os.environ.get("SKIP_IOT_PROVISIONING", "").lower() in {"1", "true", "yes"}


def _unwrap_pipe_input(event: dict[str, Any] | list[Any]) -> dict[str, Any]:
    if isinstance(event, list):
        if not event:
            raise ValueError("Pipe input array is empty")
        first = event[0]
        if not isinstance(first, dict):
            raise ValueError("Pipe input array must contain stream record objects")
        return first

    if "dynamodb" in event:
        return event

    records = event.get("Records")
    if isinstance(records, list) and records:
        first = records[0]
        if isinstance(first, dict):
            return first

    return event


def parse_stream_record(record: dict[str, Any]) -> dict[str, Any] | None:
    if record.get("eventName") != "INSERT":
        return None

    dynamodb = record.get("dynamodb", {})
    keys = dynamodb.get("Keys", {})
    sk = keys.get("SK", {}).get("S", "")
    if not sk.startswith("DEVICE#"):
        return None

    new_image = dynamodb.get("NewImage", {})
    lifecycle = new_image.get("lifecycleStatus", {}).get("S")
    if lifecycle != "PROVISIONING":
        return None

    device_id = new_image.get("deviceId", {}).get("S", sk.removeprefix("DEVICE#"))
    return {
        "tenantPk": new_image.get("PK", {}).get("S", DEMO_TENANT_PK),
        "deviceId": device_id,
        "name": new_image.get("name", {}).get("S", ""),
        "type": new_image.get("type", {}).get("S", ""),
        "configuration": new_image.get("configuration", {}).get("S"),
        "thingName": thing_name_for(device_id),
        "ssmCertPrefix": ssm_prefix_for(device_id),
        "skipIot": skip_iot_provisioning(),
    }


def shadow_desired(configuration: str | None, device_type: str) -> dict[str, Any]:
    import json

    desired: dict[str, Any] = {"type": device_type}
    if configuration:
        try:
            desired["configuration"] = json.loads(configuration)
        except json.JSONDecodeError:
            desired["configuration"] = configuration
    return desired
