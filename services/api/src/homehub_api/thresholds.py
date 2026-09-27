"""Per-device alert thresholds stored in device configuration."""

from __future__ import annotations

from homehub_api.device_configuration import ConfigInput, as_config_dict

DEFAULT_THRESHOLDS: dict[str, float] = {
    "humidityWarning": 70.0,
    "temperatureWarning": 28.0,
    "coAlarm": 50.0,
    "vocIndexWarning": 200.0,
}


def parse_thresholds(configuration: ConfigInput = None) -> dict[str, float]:
    thresholds = dict(DEFAULT_THRESHOLDS)
    parsed = as_config_dict(configuration)
    raw = parsed.get("thresholds")
    if not isinstance(raw, dict):
        return thresholds

    for key, value in raw.items():
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            thresholds[str(key)] = float(value)
    return thresholds
