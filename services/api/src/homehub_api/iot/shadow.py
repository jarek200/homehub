"""IoT Thing Shadow helpers for device configuration sync."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import boto3

from homehub_api.iot.sfn.common import shadow_desired, thing_name_for

logger = logging.getLogger(__name__)


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


def push_device_shadow_desired(
    *,
    device_id: str,
    device_type: str,
    configuration: str | dict[str, Any] | None,
    thing_name: str | None = None,
) -> None:
    endpoint = os.environ.get("IOT_DATA_ENDPOINT", "").strip()
    if not endpoint:
        logger.debug("IOT_DATA_ENDPOINT not set; skipping shadow update for %s", device_id)
        return

    thing = thing_name or thing_name_for(device_id)
    desired = shadow_desired(configuration, device_type)
    if device_type == "camera":
        camera_configuration = desired.setdefault("configuration", {})
        camera_configuration["pan"] = None
        camera_configuration["tilt"] = None

    try:
        iot_data = boto3.client("iot-data", endpoint_url=endpoint)
        iot_data.update_thing_shadow(
            thingName=thing,
            payload=json.dumps({"state": {"desired": desired}}).encode(),
        )
        logger.info("Updated thing shadow desired state for %s", thing)
    except Exception:
        logger.exception("Failed to update thing shadow for %s", thing)
