"""Versioned household event envelopes published to AppSync Events."""

from __future__ import annotations

import re
from typing import Any, cast

from homehub_api.sensor_history import SENSOR_HISTORY_KEY, sanitize_sensor_history

HOUSEHOLD_STATE_EVENT_TYPE = "household.state.v1"
CAMERA_SNAPSHOT_EVENT_TYPE = "camera.snapshot.v1"
DEVICE_UPDATED_EVENT_TYPE = "device.updated.v1"
HOUSEHOLD_CHANNEL_NAMESPACE = "household"
HUB_STATE_SK = "HUB_STATE"

_SECRET_KEY = re.compile(
    r"(password|secret|token|apikey|api_key|credential|setupcode|setup_code|"
    r"pairing|cameraurl|camera_url|snapshoturl|snapshot_url|wifi)",
    re.IGNORECASE,
)

_ALLOWED_STATE_KEYS = {
    "lock",
    "lights",
    "plugs",
    "contacts",
    "motions",
    "climates",
    "leaks",
    "buttons",
    "scene",
    "updatedAt",
    "stateVersion",
    SENSOR_HISTORY_KEY,
}


def is_hub_state_record(record: dict[str, Any]) -> bool:
    keys = (record.get("dynamodb") or {}).get("Keys") or {}
    sk = _typed_string(keys.get("SK"))
    return sk == HUB_STATE_SK


def tenant_pk_from_record(record: dict[str, Any]) -> str | None:
    dynamodb = record.get("dynamodb") or {}
    keys = dynamodb.get("Keys") or {}
    image = dynamodb.get("NewImage") or {}
    pk = _typed_string(image.get("PK")) or _typed_string(keys.get("PK"))
    return pk or None


def channel_for_hub_pk(tenant_pk: str) -> str | None:
    from homehub_api.household import channel_for_household_pk

    return channel_for_household_pk(tenant_pk)


def _typed_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("S"), str):
        return value["S"]
    return ""


def _strip_secrets(value: Any) -> Any:
    if isinstance(value, list):
        return [_strip_secrets(item) for item in value]
    if not isinstance(value, dict):
        return value
    cleaned: dict[str, Any] = {}
    for key, item in value.items():
        if _SECRET_KEY.search(str(key)):
            continue
        cleaned[key] = _strip_secrets(item)
    return cleaned


def sanitize_household_state(state: dict[str, Any]) -> dict[str, Any]:
    cleaned = _strip_secrets(state)
    if not isinstance(cleaned, dict):
        cleaned = {}
    next_state = {key: cleaned[key] for key in _ALLOWED_STATE_KEYS if key in cleaned}
    for key in ("lights", "plugs", "contacts", "motions", "climates", "leaks", "buttons"):
        if not isinstance(next_state.get(key), list):
            next_state[key] = []
    if next_state.get("lock") is not None and not isinstance(next_state.get("lock"), dict):
        next_state["lock"] = None
    if "scene" not in next_state:
        next_state["scene"] = None
    history = sanitize_sensor_history(next_state.get(SENSOR_HISTORY_KEY))
    if history:
        next_state[SENSOR_HISTORY_KEY] = history
    elif SENSOR_HISTORY_KEY in next_state:
        del next_state[SENSOR_HISTORY_KEY]
    return next_state


def build_household_state_event(
    *,
    event_id: str,
    state: dict[str, Any],
    updated_at: str | None = None,
) -> dict[str, Any]:
    sanitized = sanitize_household_state(state)
    version = sanitized.get("stateVersion")
    try:
        state_version = int(cast(Any, version))
    except (TypeError, ValueError):
        state_version = 0
    stamp = sanitized.get("updatedAt") if isinstance(sanitized.get("updatedAt"), str) else ""
    if updated_at and not stamp:
        stamp = updated_at
        sanitized["updatedAt"] = updated_at
    return {
        "type": HOUSEHOLD_STATE_EVENT_TYPE,
        "eventId": event_id,
        "stateVersion": state_version,
        "updatedAt": stamp,
        "state": sanitized,
    }


def build_camera_snapshot_event(
    *,
    event_id: str,
    device_id: str,
    recorded_at: str,
) -> dict[str, Any]:
    return {
        "type": CAMERA_SNAPSHOT_EVENT_TYPE,
        "eventId": event_id,
        "deviceId": device_id,
        "recordedAt": recorded_at,
    }


def build_device_updated_event(
    *,
    event_id: str,
    device_id: str,
    recorded_at: str,
    status: str | None = None,
    occupied: bool | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": DEVICE_UPDATED_EVENT_TYPE,
        "eventId": event_id,
        "deviceId": device_id,
        "recordedAt": recorded_at,
    }
    if status:
        payload["status"] = status
    if occupied is not None:
        payload["occupied"] = bool(occupied)
    return payload
