"""Per-device alert thresholds stored in device configuration."""

from __future__ import annotations

import json
from typing import Any

DEFAULT_THRESHOLDS: dict[str, float] = {
    "humidityWarning": 70.0,
    "temperatureWarning": 28.0,
    "coAlarm": 50.0,
}


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


def humidity_issue_threshold(configuration: str | None) -> float:
    return parse_thresholds(configuration)["humidityWarning"]
