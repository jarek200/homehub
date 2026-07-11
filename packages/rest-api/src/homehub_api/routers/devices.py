from fastapi import APIRouter, Depends

from homehub_api.dependencies import get_store, verify_api_key
from homehub_api.errors import ApiError
from homehub_api.models import (
    CommandListResponse,
    CommandResponse,
    CreateCommandRequest,
    CreateDeviceRequest,
    CreateReadingRequest,
    CreateReadingResponse,
    DeleteDeviceResponse,
    DeviceListResponse,
    DeviceResponse,
    ReadingListResponse,
    UpdateDeviceRequest,
)
from homehub_api.observability import MetricUnit, logger, metrics, tracer
from homehub_api.store import HubStore

router = APIRouter(prefix="/devices", dependencies=[Depends(verify_api_key)])


@router.get("", response_model=DeviceListResponse)
def list_devices(store: HubStore = Depends(get_store)) -> DeviceListResponse:
    return DeviceListResponse(items=store.list_devices())


@router.post("", response_model=DeviceResponse, status_code=201)
@tracer.capture_method
def create_device(
    payload: CreateDeviceRequest,
    store: HubStore = Depends(get_store),
) -> DeviceResponse:
    device = store.create_device(payload)
    metrics.add_metric(name="DeviceCreated", unit=MetricUnit.Count, value=1)
    logger.info("Device created", extra={"device_id": device.device_id, "type": device.type})
    return device


@router.get("/{device_id}", response_model=DeviceResponse)
def get_device(device_id: str, store: HubStore = Depends(get_store)) -> DeviceResponse:
    device = store.get_device(device_id)
    if not device:
        raise ApiError("Device not found", 404, "NotFound")
    return device


@router.patch("/{device_id}", response_model=DeviceResponse)
def update_device(
    device_id: str,
    payload: UpdateDeviceRequest,
    store: HubStore = Depends(get_store),
) -> DeviceResponse:
    return store.update_device(device_id, payload)


@router.delete("/{device_id}", response_model=DeleteDeviceResponse)
def delete_device(
    device_id: str,
    store: HubStore = Depends(get_store),
) -> DeleteDeviceResponse:
    result = store.delete_device(device_id)
    return DeleteDeviceResponse.model_validate(result)


@router.get("/{device_id}/readings", response_model=ReadingListResponse)
def list_readings(device_id: str, store: HubStore = Depends(get_store)) -> ReadingListResponse:
    return ReadingListResponse(items=store.list_readings(device_id))


@router.post("/{device_id}/readings", response_model=CreateReadingResponse, status_code=201)
@tracer.capture_method
def create_reading(
    device_id: str,
    payload: CreateReadingRequest,
    store: HubStore = Depends(get_store),
) -> CreateReadingResponse:
    result = store.create_reading(device_id, payload)
    metrics.add_metric(name="ReadingCreated", unit=MetricUnit.Count, value=1)
    if result.issue is not None:
        metrics.add_metric(name="HumidityIssueRaised", unit=MetricUnit.Count, value=1)
        logger.info(
            "Humidity issue raised from reading",
            extra={"device_id": device_id, "issue_id": result.issue.issue_id},
        )
    return result


@router.get("/{device_id}/commands", response_model=CommandListResponse)
def list_commands(device_id: str, store: HubStore = Depends(get_store)) -> CommandListResponse:
    return CommandListResponse(items=store.list_commands(device_id))


@router.post("/{device_id}/commands", response_model=CommandResponse, status_code=201)
@tracer.capture_method
def create_command(
    device_id: str,
    payload: CreateCommandRequest,
    store: HubStore = Depends(get_store),
) -> CommandResponse:
    command = store.create_command(device_id, payload)
    metrics.add_metric(name="CommandCreated", unit=MetricUnit.Count, value=1)
    logger.info(
        "Command created",
        extra={"device_id": device_id, "command_id": command.command_id},
    )
    return command
