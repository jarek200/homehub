"""Apply IoT shadow deltas to local device configuration.

Mirrors homehub_api.iot.shadow so the simulator can run without the API package.
"""

from __future__ import annotations

import json
from typing import Any


def parse_configuration(configuration: str | None) -> dict[str, Any]:
    if not configuration:
        return {}
    try:
        parsed = json.loads(configuration)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def merge_configuration(base: dict[str, Any], patch: Any) -> dict[str, Any]:
    if isinstance(patch, str):
        try:
            patch = json.loads(patch)
        except json.JSONDecodeError:
            return dict(base)
    if not isinstance(patch, dict):
        return dict(base)

    merged = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_configuration(merged[key], value)
        else:
            merged[key] = value
    return merged


def apply_shadow_state(
    *,
    configuration: str | None,
    device_type: str,
    state: dict[str, Any],
) -> tuple[str | None, dict[str, Any]]:
    reported: dict[str, Any] = {}
    merged = parse_configuration(configuration)

    configuration_patch = state.get("configuration")
    if configuration_patch is not None:
        merged = merge_configuration(merged, configuration_patch)
        reported["configuration"] = merged

    if "type" in state:
        reported["type"] = state["type"]
    elif device_type:
        reported["type"] = device_type

    configuration_json = json.dumps(merged) if merged else None
    return configuration_json, reported
