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
RuntimeKind = Literal["physical", "matter"]
DeviceType = Literal[
    "environmental-sensor",
    "camera",
    "matter-gateway",
    "light",
    "plug",
    "contact-sensor",
    "leak-sensor",
    "motion-sensor",
    "button",
    "lock",
    "blind",
]


class CreateDeviceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=INPUT_LIMITS["name"])
    type: DeviceType = Field(
        description=(
            "Device kind. One of: environmental-sensor, camera, matter-gateway, light, "
            "plug, contact-sensor, "
            "leak-sensor, motion-sensor, button, lock, blind."
        ),
    )
    location: str = Field(min_length=1, max_length=INPUT_LIMITS["location"])
    runtime_kind: RuntimeKind = Field(default="physical", alias="runtimeKind")
    gateway_id: str | None = Field(default=None, alias="gatewayId")
    node_id: int | None = Field(default=None, alias="nodeId", ge=1)
    endpoint: int | None = Field(default=None, ge=1)
    clusters: list[str] | None = None
    configuration: DeviceConfiguration | None = None

    model_config = {"populate_by_name": True}

    @field_validator("name", "location", mode="before")
    @classmethod
    def strip_required(cls, value: str) -> str:
        return value.strip()

    @field_validator("type", mode="before")
    @classmethod
    def normalize_type(cls, value: str) -> str:
        if not isinstance(value, str):
            return value
        return value.strip()

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
        return value.strip()

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
    runtime_kind: RuntimeKind = Field(default="physical", alias="runtimeKind")
    gateway_id: str | None = Field(default=None, alias="gatewayId")
    node_id: int | None = Field(default=None, alias="nodeId")
    endpoint: int | None = None
    clusters: list[str] | None = None
    status: DeviceStatus
    lifecycle_status: LifecycleStatus = Field(default="READY", alias="lifecycleStatus")
    thing_name: str | None = Field(default=None, alias="thingName")
    certificate_id: str | None = Field(default=None, alias="certificateId")
    failure_reason: str | None = Field(default=None, alias="failureReason")
    configuration: DeviceConfiguration | None = None
    last_seen_at: str | None = Field(default=None, alias="lastSeenAt")
    last_snapshot_key: str | None = Field(default=None, alias="lastSnapshotKey")
    last_snapshot_at: str | None = Field(default=None, alias="lastSnapshotAt")
    last_reading: ReadingResponse | None = Field(default=None, alias="lastReading")
    recent_readings: list[ReadingResponse] = Field(default_factory=list, alias="recentReadings")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}

    @field_validator("configuration", mode="before")
    @classmethod
    def parse_configuration(cls, value: Any) -> DeviceConfiguration | None:
        return configuration_from_storage(value)


class DeviceSnapshotResponse(BaseModel):
    url: str
    recorded_at: str | None = Field(default=None, alias="recordedAt")

    model_config = {"populate_by_name": True}


class DeviceSnapshotListResponse(BaseModel):
    items: list[DeviceSnapshotResponse]
    sampled: bool
    total: int

    model_config = {"populate_by_name": True}


class DeviceListResponse(BaseModel):
    items: list[DeviceResponse]
    next_cursor: str | None = Field(default=None, alias="nextCursor")

    model_config = {"populate_by_name": True}


class ReadingListResponse(BaseModel):
    items: list[ReadingResponse]


class SensorEventResponse(BaseModel):
    device_id: str = Field(alias="deviceId")
    name: str
    kind: Literal["contact", "motion"]
    value: Literal["OPEN", "DETECTED"]
    at: str

    model_config = {"populate_by_name": True}


class SensorEventListResponse(BaseModel):
    items: list[SensorEventResponse]


class UserResponse(BaseModel):
    user_id: str = Field(alias="userId")
    username: str
    email: str
    name: str | None = None
    household_id: str | None = Field(default=None, alias="householdId")
    role: Literal["OWNER", "MEMBER"] | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class HouseholdMemberResponse(BaseModel):
    user_id: str = Field(alias="userId")
    email: str
    role: Literal["OWNER", "MEMBER"]
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class HouseholdResponse(BaseModel):
    household_id: str = Field(alias="householdId")
    role: Literal["OWNER", "MEMBER"]
    created: bool = False
    token_refresh_required: bool = Field(default=False, alias="tokenRefreshRequired")
    members: list[HouseholdMemberResponse] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class DeleteDeviceResponse(BaseModel):
    deleted: bool
    device_id: str = Field(alias="deviceId")

    model_config = {"populate_by_name": True}


HubCommandName = Literal[
    "all-lights-off",
    "all-plugs-off",
    "lock-house",
    "unlock-house",
    "evening",
    "home",
    "away",
]


class HouseholdCommandRequest(BaseModel):
    command: HubCommandName


class HouseholdDeviceRequest(BaseModel):
    kind: Literal["light", "plug"]
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    on: bool | None = None
    brightness: int | None = Field(default=None, ge=0, le=100)

    @model_validator(mode="after")
    def require_action(self) -> "HouseholdDeviceRequest":
        if self.kind == "light" and self.on is None and self.brightness is None:
            raise ValueError("on or brightness required")
        if self.kind == "plug" and self.on is None:
            raise ValueError("on required")
        return self


class HouseholdStateResponse(BaseModel):
    state: dict[str, Any]


class HouseholdPlanRequest(BaseModel):
    plan: dict[str, Any]
    library: dict[str, Any] | None = None


class HouseholdPlanResponse(BaseModel):
    plan: dict[str, Any] | None = None
    library: dict[str, Any] | None = None


class HouseholdRulesResponse(BaseModel):
    rules: list[dict[str, Any]]


class HouseholdRulesRequest(BaseModel):
    rules: list[dict[str, Any]]


class MatterProductResponse(BaseModel):
    product_id: str = Field(alias="productId")
    name: str
    label: str
    type: str
    household: str
    endpoint: int
    clusters: list[str]
    cluster_endpoints: dict[str, int] | None = Field(default=None, alias="clusterEndpoints")

    model_config = {"populate_by_name": True}


class MatterProductListResponse(BaseModel):
    items: list[MatterProductResponse]


class CreateMatterCommissionRequest(BaseModel):
    product_id: str = Field(alias="productId", min_length=1, max_length=64)
    setup_payload: str = Field(alias="setupPayload", min_length=1, max_length=256)
    gateway_id: str | None = Field(default=None, alias="gatewayId", max_length=64)
    name: str | None = Field(default=None, max_length=INPUT_LIMITS["name"])
    location: str | None = Field(default=None, max_length=INPUT_LIMITS["location"])

    model_config = {"populate_by_name": True}

    @field_validator("name", "location", "gateway_id", mode="before")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class MatterCommissionResponse(BaseModel):
    commission_id: str = Field(alias="commissionId")
    status: Literal["pairing", "succeeded", "failed"]
    product_id: str = Field(alias="productId")
    gateway_id: str = Field(alias="gatewayId")
    node_id: int = Field(alias="nodeId")
    name: str | None = None
    location: str | None = None
    device_id: str | None = Field(default=None, alias="deviceId")
    error: str | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

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
