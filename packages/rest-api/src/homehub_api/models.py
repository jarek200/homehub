from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from homehub_api.config import INPUT_LIMITS

DeviceStatus = Literal["ONLINE", "OFFLINE", "UNKNOWN"]
LifecycleStatus = Literal["PROVISIONING", "READY", "FAILED", "DECOMMISSIONED"]
CommandStatus = Literal["PENDING", "SENT", "ACKNOWLEDGED", "FAILED"]
IssueStatus = Literal["OPEN", "MONITORING", "RESOLVED"]
IssueSeverity = Literal["LOW", "MEDIUM", "HIGH"]


class CreateDeviceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=INPUT_LIMITS["name"])
    type: str = Field(min_length=1, max_length=INPUT_LIMITS["type"])
    location: str | None = Field(default=None, max_length=INPUT_LIMITS["location"])
    configuration: str | None = Field(default=None, max_length=INPUT_LIMITS["configuration"])

    @field_validator("name", "type", mode="before")
    @classmethod
    def strip_required(cls, value: str) -> str:
        return value.strip()


class UpdateDeviceRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=INPUT_LIMITS["name"])
    type: str | None = Field(default=None, max_length=INPUT_LIMITS["type"])
    location: str | None = Field(default=None, max_length=INPUT_LIMITS["location"])
    status: DeviceStatus | None = None
    configuration: str | None = Field(default=None, max_length=INPUT_LIMITS["configuration"])
    last_seen_at: str | None = Field(default=None, alias="lastSeenAt")

    @model_validator(mode="after")
    def require_one_field(self) -> "UpdateDeviceRequest":
        if not self.model_dump(exclude_none=True, by_alias=True):
            raise ValueError("At least one field is required")
        return self


class CreateReadingRequest(BaseModel):
    temperature: float | None = None
    humidity: float | None = Field(default=None, ge=0, le=100)
    motion_detected: bool | None = Field(default=None, alias="motionDetected")
    camera_online: bool | None = Field(default=None, alias="cameraOnline")
    recorded_at: str | None = Field(default=None, alias="recordedAt")

    @model_validator(mode="after")
    def require_one_value(self) -> "CreateReadingRequest":
        if (
            self.temperature is None
            and self.humidity is None
            and self.motion_detected is None
            and self.camera_online is None
        ):
            raise ValueError("At least one reading value is required")
        return self


class CreateCommandRequest(BaseModel):
    command: str = Field(min_length=1, max_length=INPUT_LIMITS["command"])

    @field_validator("command", mode="before")
    @classmethod
    def strip_command(cls, value: str) -> str:
        return value.strip()


class CreateIssueRequest(BaseModel):
    title: str = Field(min_length=1, max_length=INPUT_LIMITS["issue_title"])
    device_id: str | None = Field(default=None, alias="deviceId")
    severity: IssueSeverity = "MEDIUM"
    status: IssueStatus = "OPEN"
    notes: str | None = Field(default=None, max_length=INPUT_LIMITS["issue_notes"])

    @field_validator("title", mode="before")
    @classmethod
    def strip_title(cls, value: str) -> str:
        return value.strip()


class UpdateIssueRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=INPUT_LIMITS["issue_title"])
    device_id: str | None = Field(default=None, alias="deviceId")
    severity: IssueSeverity | None = None
    status: IssueStatus | None = None
    notes: str | None = Field(default=None, max_length=INPUT_LIMITS["issue_notes"])

    @model_validator(mode="after")
    def require_one_field(self) -> "UpdateIssueRequest":
        if not self.model_dump(exclude_none=True, by_alias=True):
            raise ValueError("At least one field is required")
        return self


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
    configuration: str | None = None
    last_seen_at: str | None = Field(default=None, alias="lastSeenAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class ReadingResponse(BaseModel):
    reading_id: str = Field(alias="readingId")
    device_id: str = Field(alias="deviceId")
    temperature: float | None = None
    humidity: float | None = None
    motion_detected: bool | None = Field(default=None, alias="motionDetected")
    camera_online: bool | None = Field(default=None, alias="cameraOnline")
    recorded_at: str = Field(alias="recordedAt")
    created_at: str = Field(alias="createdAt")

    model_config = {"populate_by_name": True}


class CommandResponse(BaseModel):
    command_id: str = Field(alias="commandId")
    device_id: str = Field(alias="deviceId")
    command: str
    status: CommandStatus
    result: str | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class IssueResponse(BaseModel):
    issue_id: str = Field(alias="issueId")
    title: str
    device_id: str | None = Field(default=None, alias="deviceId")
    severity: IssueSeverity
    status: IssueStatus
    notes: str | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class DeviceListResponse(BaseModel):
    items: list[DeviceResponse]


class ReadingListResponse(BaseModel):
    items: list[ReadingResponse]


class CommandListResponse(BaseModel):
    items: list[CommandResponse]


class IssueListResponse(BaseModel):
    items: list[IssueResponse]


class UpdateUserRequest(BaseModel):
    name: str | None = Field(default=None, max_length=INPUT_LIMITS["name"])
    bio: str | None = Field(default=None, max_length=INPUT_LIMITS["bio"])
    avatar: str | None = Field(default=None, max_length=INPUT_LIMITS["avatar"])


class UserResponse(BaseModel):
    user_id: str = Field(alias="userId")
    username: str
    email: str
    name: str | None = None
    bio: str | None = None
    avatar: str | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class DeleteDeviceResponse(BaseModel):
    deleted: bool
    device_id: str = Field(alias="deviceId")

    model_config = {"populate_by_name": True}


class CreateReadingResponse(BaseModel):
    reading: ReadingResponse
    issue: IssueResponse | None = None


class ServiceInfoResponse(BaseModel):
    service: str
    version: str
    framework: str
    endpoints: list[str]
