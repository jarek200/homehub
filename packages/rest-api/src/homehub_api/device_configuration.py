"""Device configuration: API object ↔ Dynamo/shadow JSON string."""

from __future__ import annotations

import json
from typing import Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer, model_validator

from homehub_api.config import INPUT_LIMITS

# Internal (Dynamo / shadow) may still be a JSON string; API payloads are objects only.
ConfigInput = str | dict[str, Any] | BaseModel | None

PowerMode = Literal["low-power-voc", "maintenance", "always-on", "sleep-motion"]
CameraPowerMode = Literal["always-on", "sleep-motion"]
CameraFrameSize = Literal[
    "qqvga",
    "qcif",
    "qvga",
    "cif",
    "hvga",
    "vga",
    "svga",
    "xga",
    "hd",
    "sxga",
    "uxga",
]
CameraCaptureMode = Literal["both", "interval", "motion"]
CAMERA_REPORTING_MIN_SECONDS = 15
CAMERA_REPORTING_MAX_SECONDS = 3600

PHYSICAL_REPORTING_MIN_SECONDS = 60
PHYSICAL_REPORTING_MAX_SECONDS = 3600
ENVIRONMENTAL_DEFAULT_REPORTING_SECONDS = 300


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
    power_mode: PowerMode | None = Field(default=None, alias="powerMode")
    maintenance_mode: bool | None = Field(default=None, alias="maintenanceMode")
    frame_size: CameraFrameSize | None = Field(default=None, alias="frameSize")
    jpeg_quality: int | None = Field(default=None, alias="jpegQuality", ge=4, le=63)
    brightness: int | None = Field(default=None, ge=-2, le=2)
    saturation: int | None = Field(default=None, ge=-2, le=2)
    contrast: int | None = Field(default=None, ge=-2, le=2)
    vflip: bool | None = None
    hmirror: bool | None = None
    motion_enabled: bool | None = Field(default=None, alias="motionEnabled")
    motion_cooldown_seconds: int | None = Field(
        default=None, alias="motionCooldownSeconds", ge=5, le=300
    )
    capture_mode: CameraCaptureMode | None = Field(default=None, alias="captureMode")

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


CAMERA_DEFAULT_CONFIGURATION: dict[str, Any] = {
    "reportingIntervalSeconds": 30,
    "pan": 90,
    "tilt": 90,
    "frameSize": "qvga",
    "jpegQuality": 12,
    "brightness": 1,
    "saturation": -2,
    "contrast": 0,
    "vflip": True,
    "hmirror": False,
    "motionEnabled": True,
    "motionCooldownSeconds": 15,
    "captureMode": "both",
    "powerMode": "always-on",
    "maintenanceMode": False,
}

ENVIRONMENTAL_DEFAULT_CONFIGURATION: dict[str, Any] = {
    "reportingIntervalSeconds": ENVIRONMENTAL_DEFAULT_REPORTING_SECONDS,
    "powerMode": "low-power-voc",
    "maintenanceMode": False,
    "thresholds": {
        "humidityWarning": 70.0,
        "temperatureWarning": 28.0,
        "vocIndexWarning": 200.0,
    },
}


def _clamp_physical_reporting_interval(data: dict[str, Any]) -> dict[str, Any]:
    interval = data.get("reportingIntervalSeconds")
    if not isinstance(interval, int):
        return data
    if interval < PHYSICAL_REPORTING_MIN_SECONDS:
        data["reportingIntervalSeconds"] = PHYSICAL_REPORTING_MIN_SECONDS
    elif interval > PHYSICAL_REPORTING_MAX_SECONDS:
        data["reportingIntervalSeconds"] = PHYSICAL_REPORTING_MAX_SECONDS
    return data




def _clamp_camera_reporting_interval(data: dict[str, Any]) -> dict[str, Any]:
    interval = data.get("reportingIntervalSeconds")
    if not isinstance(interval, int):
        return data
    if interval < CAMERA_REPORTING_MIN_SECONDS:
        data["reportingIntervalSeconds"] = CAMERA_REPORTING_MIN_SECONDS
    elif interval > CAMERA_REPORTING_MAX_SECONDS:
        data["reportingIntervalSeconds"] = CAMERA_REPORTING_MAX_SECONDS
    return data


def _normalize_camera_configuration(data: dict[str, Any]) -> dict[str, Any]:
    merged = dict(CAMERA_DEFAULT_CONFIGURATION)
    merged.update(data)
    frame_size = merged.get("frameSize")
    if frame_size not in get_args(CameraFrameSize):
        merged["frameSize"] = CAMERA_DEFAULT_CONFIGURATION["frameSize"]
    for key, bounds in (
        ("jpegQuality", (4, 63)),
        ("brightness", (-2, 2)),
        ("saturation", (-2, 2)),
        ("contrast", (-2, 2)),
    ):
        value = merged.get(key)
        if isinstance(value, bool) or not isinstance(value, int):
            merged[key] = CAMERA_DEFAULT_CONFIGURATION[key]
        else:
            merged[key] = max(bounds[0], min(bounds[1], value))
    for key in ("vflip", "hmirror", "motionEnabled"):
        value = merged.get(key)
        if not isinstance(value, bool):
            merged[key] = CAMERA_DEFAULT_CONFIGURATION[key]
    capture_mode = merged.get("captureMode")
    if capture_mode not in get_args(CameraCaptureMode):
        merged["captureMode"] = CAMERA_DEFAULT_CONFIGURATION["captureMode"]
    cooldown = merged.get("motionCooldownSeconds")
    if not isinstance(cooldown, int):
        merged["motionCooldownSeconds"] = CAMERA_DEFAULT_CONFIGURATION["motionCooldownSeconds"]
    else:
        merged["motionCooldownSeconds"] = max(5, min(300, cooldown))
    power_mode = merged.get("powerMode")
    if power_mode not in get_args(CameraPowerMode):
        merged["powerMode"] = CAMERA_DEFAULT_CONFIGURATION["powerMode"]
    maintenance_mode = merged.get("maintenanceMode")
    if not isinstance(maintenance_mode, bool):
        merged["maintenanceMode"] = CAMERA_DEFAULT_CONFIGURATION["maintenanceMode"]
    return _clamp_camera_reporting_interval(merged)


def normalize_configuration_update(
    device_type: str,
    runtime_kind: str,
    existing: ConfigInput,
    patch: ConfigInput,
) -> str | None:
    merged = {**as_config_dict(existing), **as_config_dict(patch)}
    if device_type == "camera":
        merged = _normalize_camera_configuration(merged)
    elif device_type == "environmental-sensor" and runtime_kind == "physical":
        merged = _clamp_physical_reporting_interval(merged)
    return json.dumps(merged) if merged else None


def configuration_for_create(
    device_type: str,
    configuration: ConfigInput,
    *,
    runtime_kind: str = "simulated",
) -> str | None:
    """Apply type defaults when registering a device."""
    data = as_config_dict(configuration)
    if device_type == "camera":
        merged = _normalize_camera_configuration(data)
        return json.dumps(merged)
    if device_type == "environmental-sensor":
        merged = dict(ENVIRONMENTAL_DEFAULT_CONFIGURATION)
        merged.update(data)
        if runtime_kind == "physical":
            merged = _clamp_physical_reporting_interval(merged)
        return json.dumps(merged)
    return json.dumps(data) if data else None
