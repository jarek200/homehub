from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from homehub_api.config import INPUT_LIMITS
from homehub_api.device_configuration import (
    DeviceConfiguration,
    coerce_configuration,
    configuration_from_storage,
)

DeviceStatus = Literal["ONLINE", "OFFLINE", "UNKNOWN"]
LifecycleStatus = Literal["PROVISIONING", "READY", "FAILED", "DECOMMISSIONED"]
ReadingState = Literal["normal", "warning"]
DeviceType = Literal["heat-alarm", "carbon-monoxide-alarm", "humidity-sensor"]

DEVICE_TYPE_ALIASES = {
    "environmental-sensor": "humidity-sensor",
}


def _normalize_device_type(value: str) -> str:
    stripped = value.strip()
    return DEVICE_TYPE_ALIASES.get(stripped, stripped)


class CreateDeviceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=INPUT_LIMITS["name"])
    type: DeviceType = Field(
        description=(
            "Device kind. One of: heat-alarm, carbon-monoxide-alarm, humidity-sensor."
        ),
    )
    location: str = Field(min_length=1, max_length=INPUT_LIMITS["location"])
    configuration: DeviceConfiguration | None = None

    @field_validator("name", "location", mode="before")
    @classmethod
    def strip_required(cls, value: str) -> str:
        return value.strip()

    @field_validator("type", mode="before")
    @classmethod
    def normalize_type(cls, value: str) -> str:
        if not isinstance(value, str):
            return value
        return _normalize_device_type(value)

    @field_validator("configuration", mode="before")
    @classmethod
    def parse_configuration(cls, value: Any) -> DeviceConfiguration | None:
        return coerce_configuration(value)


class UpdateDeviceRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=INPUT_LIMITS["name"])
    type: DeviceType | None = Field(
        default=None,
        description="Cannot be changed after registration.",
    )
    location: str | None = Field(default=None, min_length=1, max_length=INPUT_LIMITS["location"])
    status: DeviceStatus | None = None
    configuration: DeviceConfiguration | None = None
    last_seen_at: str | None = Field(default=None, alias="lastSeenAt")

    @field_validator("name", "location", mode="before")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()

    @field_validator("type", mode="before")
    @classmethod
    def normalize_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        return _normalize_device_type(value)

    @field_validator("configuration", mode="before")
    @classmethod
    def parse_configuration(cls, value: Any) -> DeviceConfiguration | None:
        return coerce_configuration(value)

    @model_validator(mode="after")
    def require_one_field(self) -> "UpdateDeviceRequest":
        if not self.model_dump(exclude_none=True, by_alias=True):
            raise ValueError("At least one field is required")
        return self


class ReadingResponse(BaseModel):
    reading_id: str = Field(alias="readingId")
    device_id: str = Field(alias="deviceId")
    alarm: bool = False
    state: ReadingState = "normal"
    metrics: dict[str, float | bool] = Field(default_factory=dict)
    recorded_at: str = Field(alias="recordedAt")
    created_at: str = Field(alias="createdAt")

    model_config = {"populate_by_name": True}


class DeviceResponse(BaseModel):
    device_id: str = Field(alias="deviceId")
    name: str
    type: str
    location: str | None = None
    status: DeviceStatus
    lifecycle_status: LifecycleStatus = Field(default="READY", alias="lifecycleStatus")
    thing_name: str | None = Field(default=None, alias="thingName")
    certificate_id: str | None = Field(default=None, alias="certificateId")
    failure_reason: str | None = Field(default=None, alias="failureReason")
    configuration: DeviceConfiguration | None = None
    last_seen_at: str | None = Field(default=None, alias="lastSeenAt")
    last_reading: ReadingResponse | None = Field(default=None, alias="lastReading")
    recent_readings: list[ReadingResponse] = Field(default_factory=list, alias="recentReadings")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}

    @field_validator("configuration", mode="before")
    @classmethod
    def parse_configuration(cls, value: Any) -> DeviceConfiguration | None:
        return configuration_from_storage(value)


class DeviceListResponse(BaseModel):
    items: list[DeviceResponse]
    next_cursor: str | None = Field(default=None, alias="nextCursor")

    model_config = {"populate_by_name": True}


class ReadingListResponse(BaseModel):
    items: list[ReadingResponse]


class UserResponse(BaseModel):
    user_id: str = Field(alias="userId")
    username: str
    email: str
    name: str | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class DeleteDeviceResponse(BaseModel):
    deleted: bool
    device_id: str = Field(alias="deviceId")

    model_config = {"populate_by_name": True}


class ServiceInfoResponse(BaseModel):
    service: str
    version: str
    framework: str
    endpoints: list[str]


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadyResponse(BaseModel):
    status: Literal["ready"] = "ready"
