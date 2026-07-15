"""Shared helpers for IoT Step Functions provisioning tasks."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

from homehub_api.config import DEMO_TENANT_PK

PROVISION_CONTEXT_KEYS = (
    "tenantPk",
    "deviceId",
    "name",
    "type",
    "configuration",
    "thingName",
    "ssmCertPrefix",
    "skipIot",
    "certificateArn",
    "certificateId",
)

NESTED_STEP_RESULT_KEYS = ("cert", "certResult", "thing", "thingResult")


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def thing_name_for(device_id: str) -> str:
    return f"homehub-{device_id}"


def ssm_prefix_for(device_id: str) -> str:
    return f"/homehub/devices/{device_id}"


def skip_iot_provisioning() -> bool:
    return os.environ.get("SKIP_IOT_PROVISIONING", "").lower() in {"1", "true", "yes"}


def _device_id_from_hints(event: dict[str, Any]) -> str | None:
    prefix = event.get("ssmCertPrefix")
    if isinstance(prefix, str) and prefix.startswith("/homehub/devices/"):
        device_id = prefix.removeprefix("/homehub/devices/").strip("/")
        if device_id:
            return device_id

    thing_name = event.get("thingName")
    if isinstance(thing_name, str) and thing_name.startswith("homehub-"):
        device_id = thing_name.removeprefix("homehub-")
        if device_id:
            return device_id

    return None


def _flatten_step_results(event: dict[str, Any]) -> dict[str, Any]:
    flattened = dict(event)

    payload = flattened.get("Payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = None
    if isinstance(payload, dict):
        flattened = {**flattened, **payload}

    for nested_key in NESTED_STEP_RESULT_KEYS:
        nested = flattened.get(nested_key)
        if isinstance(nested, dict):
            flattened = {**flattened, **nested}

    return flattened


def merge_provision_context(event: dict[str, Any], **updates: Any) -> dict[str, Any]:
    """Carry provisioning identifiers through each Step Functions task."""
    context = resolve_provision_context(event)
    context.update(updates)
    return context


def resolve_provision_context(event: dict[str, Any]) -> dict[str, Any]:
    """Normalize the Step Functions payload into a provisioning context dict."""
    if not isinstance(event, dict):
        raise KeyError("deviceId")

    flattened = _flatten_step_results(event)

    if flattened.get("deviceId") and flattened.get("tenantPk"):
        return {key: flattened[key] for key in PROVISION_CONTEXT_KEYS if key in flattened}

    parsed = parse_stream_record(flattened)
    if parsed:
        merged = dict(parsed)
        for key in PROVISION_CONTEXT_KEYS:
            if key in flattened and flattened[key] is not None:
                merged[key] = flattened[key]
        return merged

    device_id = _device_id_from_hints(flattened)
    tenant_pk = flattened.get("tenantPk")
    if device_id and tenant_pk:
        merged = {key: flattened[key] for key in PROVISION_CONTEXT_KEYS if key in flattened}
        merged["deviceId"] = device_id
        merged["tenantPk"] = tenant_pk
        return merged

    raise KeyError("deviceId")


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


def shadow_desired(
    configuration: str | dict[str, Any] | None, device_type: str
) -> dict[str, Any]:
    from homehub_api.device_configuration import as_config_dict

    desired: dict[str, Any] = {"type": device_type}
    parsed = as_config_dict(configuration)
    if parsed:
        desired["configuration"] = parsed
    return desired
