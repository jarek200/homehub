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
    "vocIndexWarning": 200.0,
}


def normalize_device_type(device_type: str | None) -> str | None:
    if not device_type:
        return device_type
    return device_type


def _is_humidity_sensor(device_type: str | None) -> bool:
    return normalize_device_type(device_type) == "humidity-sensor"


def _is_environmental_sensor(device_type: str | None) -> bool:
    return normalize_device_type(device_type) == "environmental-sensor"


def simulator_device_type(device_type: str) -> str:
    """Map API device types onto simulator telemetry slugs."""
    return normalize_device_type(device_type) or device_type


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

    if _is_environmental_sensor(device_type):
        return {
            "temperature": round(random.uniform(20.0, 24.0), 1),
            "humidity": round(random.uniform(45.0, 60.0), 1),
            "pressureHpa": round(random.uniform(990.0, 1020.0), 0),
            "lightLux": round(random.uniform(80.0, 400.0), 1),
            "uvMwCm2": round(random.uniform(0.0, 2.0), 2),
            "vocIndex": round(random.uniform(80.0, 140.0), 0),
            "batteryVoltage": round(random.uniform(3.8, 4.1), 2),
            "batteryPercent": round(random.uniform(55.0, 85.0), 0),
        }

    if normalized_type == "camera":
        pan, tilt = 90.0, 90.0
        if configuration:
            try:
                parsed = json.loads(configuration) if isinstance(configuration, str) else configuration
            except json.JSONDecodeError:
                parsed = {}
            if isinstance(parsed, dict):
                if isinstance(parsed.get("pan"), (int, float)):
                    pan = float(parsed["pan"])
                if isinstance(parsed.get("tilt"), (int, float)):
                    tilt = float(parsed["tilt"])
        return {"pan": pan, "tilt": tilt}

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
    voc_limit = limits.get("vocIndexWarning", DEFAULT_THRESHOLDS["vocIndexWarning"])

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
    if _is_environmental_sensor(device_type):
        voc = metrics.get("vocIndex")
        if voc is not None and float(voc) >= voc_limit:
            return False, "warning"
    return False, "normal"
