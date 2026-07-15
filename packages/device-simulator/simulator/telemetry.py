"""Mini telemetry model for the virtual device simulator."""

from __future__ import annotations

import json
import random
from typing import Literal

ReadingState = Literal["normal", "warning"]

DEFAULT_THRESHOLDS: dict[str, float] = {
    "humidityWarning": 70.0,
    "temperatureWarning": 28.0,
    "coAlarm": 50.0,
}

DEVICE_TYPE_ALIASES = {
    "environmental-sensor": "humidity-sensor",
}


def normalize_device_type(device_type: str | None) -> str | None:
    if not device_type:
        return device_type
    return DEVICE_TYPE_ALIASES.get(device_type, device_type)


def _is_humidity_sensor(device_type: str | None) -> bool:
    return normalize_device_type(device_type) == "humidity-sensor"


def simulator_device_type(device_type: str) -> str:
    """Map API device types onto simulator telemetry slugs.

    Legacy Lightsail images only sampled metrics for ``environmental-sensor``.
    """
    normalized = normalize_device_type(device_type) or device_type
    if normalized == "humidity-sensor":
        return "environmental-sensor"
    return normalized


def parse_thresholds(configuration: str | None) -> dict[str, float]:
    thresholds = dict(DEFAULT_THRESHOLDS)
    if not configuration:
        return thresholds
    try:
        parsed = json.loads(configuration)
    except json.JSONDecodeError:
        return thresholds
    raw = parsed.get("thresholds")
    if not isinstance(raw, dict):
        return thresholds
    for key, value in raw.items():
        if isinstance(value, (int, float)):
            thresholds[key] = float(value)
    return thresholds


def sample_metrics(device_type: str, configuration: str | None = None) -> dict[str, float | bool]:
    normalized_type = normalize_device_type(device_type) or device_type
    if normalized_type == "heat-alarm":
        return {
            "heat": False,
            "temperature": round(random.uniform(20.0, 28.0), 1),
        }

    if normalized_type == "carbon-monoxide-alarm":
        return {
            "co": round(random.uniform(0.0, 12.0), 1),
            "heat": False,
        }

    if _is_humidity_sensor(device_type):
        return {
            "humidity": round(random.uniform(40.0, 65.0), 1),
        }

    return {}


def derive_alarm_state(
    metrics: dict[str, float | bool],
    thresholds: dict[str, float] | None = None,
    device_type: str | None = None,
) -> tuple[bool, ReadingState]:
    limits = thresholds or DEFAULT_THRESHOLDS
    humidity_limit = limits.get("humidityWarning", DEFAULT_THRESHOLDS["humidityWarning"])
    temperature_limit = limits.get("temperatureWarning", DEFAULT_THRESHOLDS["temperatureWarning"])
    co_alarm_limit = limits.get("coAlarm", DEFAULT_THRESHOLDS["coAlarm"])

    if metrics.get("heat") is True:
        return True, "warning"
    if metrics.get("co") is not None and float(metrics["co"]) >= co_alarm_limit:
        return True, "warning"
    if metrics.get("fault") is True:
        return False, "warning"
    humidity = metrics.get("humidity")
    if humidity is not None and float(humidity) >= humidity_limit:
        return False, "warning"
    if not _is_humidity_sensor(device_type):
        temperature = metrics.get("temperature")
        if temperature is not None and float(temperature) >= temperature_limit:
            return False, "warning"
    return False, "normal"
