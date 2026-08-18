"""Device configuration: API object ↔ Dynamo/shadow JSON string."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer, model_validator

from homehub_api.config import INPUT_LIMITS

# Internal (Dynamo / shadow) may still be a JSON string; API payloads are objects only.
ConfigInput = str | dict[str, Any] | BaseModel | None


class DeviceConfiguration(BaseModel):
    """Typed device settings. Extra keys are allowed for forward compatibility."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    reporting_interval_seconds: int | None = Field(
        default=None,
        alias="reportingIntervalSeconds",
        ge=1,
    )
    pan: int | None = Field(default=None, ge=0, le=180)
    tilt: int | None = Field(default=None, ge=0, le=180)
    thresholds: dict[str, float] | None = None

    @field_validator("thresholds", mode="before")
    @classmethod
    def coerce_threshold_numbers(cls, value: Any) -> dict[str, float] | None:
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ValueError("thresholds must be an object")
        coerced: dict[str, float] = {}
        for key, raw in value.items():
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                raise ValueError(f"thresholds.{key} must be a number")
            coerced[str(key)] = float(raw)
        return coerced

    @model_validator(mode="after")
    def enforce_serialized_size(self) -> DeviceConfiguration:
        encoded = json.dumps(self.model_dump(by_alias=True, exclude_none=True))
        if len(encoded) > INPUT_LIMITS["configuration"]:
            raise ValueError(
                f"configuration exceeds {INPUT_LIMITS['configuration']} characters when serialized"
            )
        return self

    @model_serializer(mode="wrap")
    def _omit_nulls(self, handler: Any) -> dict[str, Any]:
        data = handler(self)
        return {key: value for key, value in data.items() if value is not None}


def coerce_configuration(value: Any) -> DeviceConfiguration | None:
    """API request bodies: configuration must be an object (not a JSON string)."""
    if value is None:
        return None
    if isinstance(value, DeviceConfiguration):
        return value
    if isinstance(value, str):
        raise ValueError("configuration must be an object, not a JSON string")
    if isinstance(value, dict):
        return DeviceConfiguration.model_validate(value)
    raise ValueError("configuration must be an object")


def configuration_from_storage(value: Any) -> DeviceConfiguration | None:
    """Hydrate device records from Dynamo (stored as a JSON string)."""
    if value is None:
        return None
    if isinstance(value, DeviceConfiguration):
        return value
    if isinstance(value, dict):
        return DeviceConfiguration.model_validate(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError("stored configuration is not valid JSON") from exc
        if not isinstance(parsed, dict):
            raise ValueError("stored configuration must be a JSON object")
        return DeviceConfiguration.model_validate(parsed)
    raise ValueError("stored configuration must be an object or JSON string")


def as_config_dict(configuration: ConfigInput) -> dict[str, Any]:
    if configuration is None:
        return {}
    if isinstance(configuration, DeviceConfiguration):
        return configuration.model_dump(by_alias=True, exclude_none=True)
    if isinstance(configuration, BaseModel):
        return configuration.model_dump(by_alias=True, exclude_none=True)
    if isinstance(configuration, dict):
        return dict(configuration)
    if isinstance(configuration, str):
        try:
            parsed = json.loads(configuration)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def as_config_json(configuration: ConfigInput) -> str | None:
    data = as_config_dict(configuration)
    return json.dumps(data) if data else None


CAMERA_DEFAULT_CONFIGURATION: dict[str, int] = {
    "reportingIntervalSeconds": 30,
    "pan": 90,
    "tilt": 90,
}


def configuration_for_create(device_type: str, configuration: ConfigInput) -> str | None:
    """Apply camera pan/tilt defaults when registering a device."""
    data = as_config_dict(configuration)
    if device_type == "camera":
        merged = dict(CAMERA_DEFAULT_CONFIGURATION)
        merged.update(data)
        return json.dumps(merged)
    return json.dumps(data) if data else None
