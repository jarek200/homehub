"""Shared helpers for IoT Step Functions provisioning tasks."""

from __future__ import annotations

import json
from typing import Any

from homehub_api.config import DEMO_TENANT_PK
from homehub_api.household import DEVICE_SK_PREFIX

PROVISION_CONTEXT_KEYS = (
    "tenantPk",
    "deviceId",
    "name",
    "type",
    "runtimeKind",
    "configuration",
    "thingName",
    "ssmCertPrefix",
    "certificateArn",
    "certificateId",
)

NESTED_STEP_RESULT_KEYS = ("cert", "certResult", "thing", "thingResult")


def thing_name_for(device_id: str) -> str:
    return f"homehub-{device_id}"


def ssm_prefix_for(device_id: str) -> str:
    return f"/homehub/devices/{device_id}"


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


def parse_stream_record(record: dict[str, Any]) -> dict[str, Any] | None:
    if record.get("eventName") != "INSERT":
        return None

    dynamodb = record.get("dynamodb", {})
    keys = dynamodb.get("Keys", {})
    sk = keys.get("SK", {}).get("S", "")
    if not sk.startswith(DEVICE_SK_PREFIX):
        return None

    new_image = dynamodb.get("NewImage", {})
    lifecycle = new_image.get("lifecycleStatus", {}).get("S")
    if lifecycle != "PROVISIONING":
        return None

    device_id = new_image.get("deviceId", {}).get("S", sk.removeprefix(DEVICE_SK_PREFIX))
    runtime_kind = new_image.get("runtimeKind", {}).get("S", "physical")
    return {
        "tenantPk": new_image.get("PK", {}).get("S", DEMO_TENANT_PK),
        "deviceId": device_id,
        "name": new_image.get("name", {}).get("S", ""),
        "type": new_image.get("type", {}).get("S", ""),
        "runtimeKind": runtime_kind,
        "configuration": new_image.get("configuration", {}).get("S"),
        "thingName": thing_name_for(device_id),
        "ssmCertPrefix": ssm_prefix_for(device_id),
    }


def shadow_desired(configuration: str | dict[str, Any] | None, device_type: str) -> dict[str, Any]:
    from homehub_api.device_configuration import as_config_dict

    desired: dict[str, Any] = {"type": device_type}
    parsed = as_config_dict(configuration)
    if parsed:
        desired["configuration"] = parsed
    return desired


def shadow_update_payload(
    configuration: str | dict[str, Any] | None, device_type: str
) -> dict[str, Any]:
    """Exact UpdateThingShadow body the provision state machine must send."""
    return {"state": {"desired": shadow_desired(configuration, device_type)}}
