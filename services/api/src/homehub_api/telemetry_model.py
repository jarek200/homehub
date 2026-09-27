"""Mini telemetry model: alarm + state + flexible metrics bag."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, Literal

from homehub_api.thresholds import DEFAULT_THRESHOLDS, parse_thresholds

ReadingState = Literal["normal", "warning"]

VALID_STATES: set[str] = {"normal", "warning"}


def _coerce_state(
    state: str,
    metrics: dict[str, float | bool],
    limits: dict[str, float],
    device_type: str | None = None,
) -> ReadingState:
    if state in VALID_STATES:
        return state  # type: ignore[return-value]
    if state in {"alarm", "fault"}:
        return "warning"
    return derive_alarm_state(metrics, limits, device_type)[1]


def _is_environmental_sensor(device_type: str | None) -> bool:
    return device_type == "environmental-sensor"


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
    if metrics.get("leak") is True:
        return True, "warning"
    if metrics.get("co") is not None and float(metrics["co"]) >= co_alarm_limit:
        return True, "warning"
    co_level = metrics.get("coLevel")
    if isinstance(co_level, str) and co_level.lower() in {"high", "medium"}:
        return True, "warning"
    if metrics.get("fault") is True:
        return False, "warning"
    humidity = metrics.get("humidity")
    if humidity is not None and float(humidity) >= humidity_limit:
        return False, "warning"
    temperature = metrics.get("temperature")
    if temperature is not None and float(temperature) >= temperature_limit:
        return False, "warning"
    if _is_environmental_sensor(device_type):
        voc = metrics.get("vocIndex")
        if voc is not None and float(voc) >= voc_limit:
            return False, "warning"
    return False, "normal"


def _parse_metrics_field(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def normalize_telemetry_event(
    event: dict[str, Any],
    *,
    configuration: Any = None,
    thresholds: dict[str, float] | None = None,
    device_type: str | None = None,
) -> dict[str, Any]:
    """Map MQTT / manual payloads into the mini reading model."""
    limits = thresholds or parse_thresholds(configuration)

    raw_metrics = _parse_metrics_field(event.get("metrics"))
    if raw_metrics:
        metrics = _coerce_metrics(raw_metrics)
        alarm, state = derive_alarm_state(metrics, limits, device_type)
        return {"alarm": alarm, "state": state, "metrics": metrics}

    metrics = _coerce_metrics({})

    for key in (
        "temperature",
        "humidity",
        "co",
        "co2",
        "vocIndex",
        "pressureHpa",
        "lightLux",
        "uvMwCm2",
        "batteryVoltage",
        "batteryPercent",
    ):
        if event.get(key) is not None and key not in metrics:
            metrics[key] = _coerce_metric_value(event[key])

    for key in ("heat", "fault"):
        if event.get(key) is not None and key not in metrics:
            metrics[key] = bool(event[key])

    alarm, state = derive_alarm_state(metrics, limits, device_type)

    return {"alarm": alarm, "state": state, "metrics": metrics}


def reading_from_dynamo(
    item: dict[str, Any],
    *,
    configuration: Any = None,
    thresholds: dict[str, float] | None = None,
    device_type: str | None = None,
) -> dict[str, Any]:
    limits = thresholds or parse_thresholds(configuration)
    raw_metrics = _parse_metrics_field(item.get("metrics"))
    if raw_metrics:
        metrics = _coerce_metrics(raw_metrics)
    else:
        metrics = _coerce_metrics({})
        for key in (
            "temperature",
            "humidity",
            "co",
            "co2",
            "vocIndex",
            "pressureHpa",
            "lightLux",
            "uvMwCm2",
            "batteryVoltage",
            "batteryPercent",
        ):
            if item.get(key) is not None:
                metrics[key] = _coerce_metric_value(item[key])
    alarm = bool(item.get("alarm", derive_alarm_state(metrics, limits, device_type)[0]))
    state = _coerce_state(
        str(item.get("state") or derive_alarm_state(metrics, limits, device_type)[1]),
        metrics,
        limits,
        device_type,
    )

    return {"alarm": alarm, "state": state, "metrics": metrics}


def metrics_to_dynamo(metrics: dict[str, float | bool]) -> dict[str, Decimal | bool]:
    """Convert metric floats to Decimal for DynamoDB writes."""
    result: dict[str, Decimal | bool] = {}
    for key, value in metrics.items():
        if isinstance(value, bool):
            result[key] = value
        else:
            result[key] = Decimal(str(value))
    return result


def _coerce_metric_value(value: Any) -> float | bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return value.lower() == "true"
    return bool(value)


def _coerce_metrics(raw: dict[str, Any]) -> dict[str, float | bool]:
    metrics: dict[str, float | bool] = {}
    for key, value in raw.items():
        if value is None:
            continue
        if isinstance(value, bool):
            metrics[key] = value
        elif isinstance(value, (int, float, Decimal)):
            metrics[key] = float(value)
        elif isinstance(value, str):
            lowered = value.lower()
            if lowered in {"true", "false"}:
                metrics[key] = lowered == "true"
            else:
                try:
                    metrics[key] = float(value)
                except ValueError:
                    continue
    return metrics
