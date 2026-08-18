from fastapi import APIRouter, Depends, Query

from homehub_api.config import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, hub_id_from_pk
from homehub_api.dependencies import get_store
from homehub_api.errors import ApiError
from homehub_api.iot.athena_history import query_device_history
from homehub_api.models import (
    CreateDeviceRequest,
    DeleteDeviceResponse,
    DeviceListResponse,
    DeviceResponse,
    DeviceSnapshotListResponse,
    DeviceSnapshotResponse,
    ReadingListResponse,
    UpdateDeviceRequest,
)
from homehub_api.observability import MetricUnit, logger, metrics, tracer
from homehub_api.store import HubStore

router = APIRouter(prefix="/devices")


@router.get("", response_model=DeviceListResponse)
def list_devices(
    store: HubStore = Depends(get_store),
    limit: int = Query(default=DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    cursor: str | None = Query(default=None),
) -> DeviceListResponse:
    page = store.list_devices(limit=limit, cursor=cursor)
    return DeviceListResponse(items=page.items, nextCursor=page.next_cursor)


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


@router.get("/{device_id}/snapshot", response_model=DeviceSnapshotResponse)
def get_device_snapshot(
    device_id: str, store: HubStore = Depends(get_store)
) -> DeviceSnapshotResponse:
    from homehub_api.iot.snapshots import presigned_snapshot_url

    device = store.get_device(device_id)
    if not device:
        raise ApiError("Device not found", 404, "NotFound")
    return presigned_snapshot_url(device)


@router.get("/{device_id}/snapshots", response_model=DeviceSnapshotListResponse)
def list_device_snapshots(
    device_id: str,
    store: HubStore = Depends(get_store),
    from_ts: str = Query(alias="from"),
    to_ts: str = Query(alias="to"),
) -> DeviceSnapshotListResponse:
    from homehub_api.iot.snapshots import list_device_snapshots as list_snapshots
    from homehub_api.iot.snapshots import parse_query_time

    device = store.get_device(device_id)
    if not device:
        raise ApiError("Device not found", 404, "NotFound")
    start = parse_query_time(from_ts, "from")
    end = parse_query_time(to_ts, "to")
    return list_snapshots(device, start=start, end=end)


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


@router.get("/{device_id}/readings/history", response_model=ReadingListResponse)
@tracer.capture_method
def list_reading_history(
    device_id: str,
    store: HubStore = Depends(get_store),
    hours: int = Query(default=3, ge=1, le=72),
) -> ReadingListResponse:
    device = store.get_device(device_id)
    if not device:
        raise ApiError("Device not found", 404, "NotFound")
    hub_id = hub_id_from_pk(store.tenant_pk)
    items = query_device_history(hub_id=hub_id, device_id=device_id, hours=hours)
    metrics.add_metric(name="AthenaHistoryQueried", unit=MetricUnit.Count, value=1)
    # Newest-first to match Dynamo list_readings ordering for the UI.
    items_newest_first = list(reversed(items))
    return ReadingListResponse(items=items_newest_first)
