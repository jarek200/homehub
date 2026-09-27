from fastapi import APIRouter, Depends, Query

from homehub_api.dependencies import get_store
from homehub_api.errors import ApiError
from homehub_api.models import SensorEventListResponse, SensorEventResponse
from homehub_api.sensor_events import SENSOR_EVENT_LIST_LIMIT, SENSOR_EVENT_LIST_MAX
from homehub_api.store import HubStore

router = APIRouter()


@router.get("/sensor-events", response_model=SensorEventListResponse)
def list_sensor_events(
    store: HubStore = Depends(get_store),
    from_ts: str = Query(alias="from"),
    to_ts: str = Query(alias="to"),
    device_id: str | None = Query(default=None, alias="deviceId"),
    kind: str | None = Query(default=None),
    limit: int = Query(default=SENSOR_EVENT_LIST_LIMIT, ge=1, le=SENSOR_EVENT_LIST_MAX),
) -> SensorEventListResponse:
    from homehub_api.iot.snapshots import parse_query_time

    start = parse_query_time(from_ts, "from")
    end = parse_query_time(to_ts, "to")
    if kind is not None and kind not in {"contact", "motion"}:
        raise ApiError("kind must be contact or motion", 400, "ValidationError")
    items = store.list_sensor_events(
        start=start,
        end=end,
        device_id=device_id,
        kind=kind,
        limit=limit or SENSOR_EVENT_LIST_LIMIT,
    )
    return SensorEventListResponse(
        items=[SensorEventResponse.model_validate(item) for item in items]
    )
