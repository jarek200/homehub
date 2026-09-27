from fastapi import APIRouter, Depends

from homehub_api.auth import AuthContext, require_auth
from homehub_api.dependencies import get_store
from homehub_api.models import (
    HouseholdCommandRequest,
    HouseholdDeviceRequest,
    HouseholdStateResponse,
)
from homehub_api.store import HubStore

router = APIRouter()


@router.get("/state", response_model=HouseholdStateResponse)
def get_household_state(
    _auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdStateResponse:
    return HouseholdStateResponse(state=store.get_hub_state())


@router.post("/commands", response_model=HouseholdStateResponse)
def post_household_command(
    payload: HouseholdCommandRequest,
    _auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdStateResponse:
    state = store.apply_household_command(payload.command)
    gateway = store.find_matter_gateway()
    if gateway:
        from homehub_api.iot.gateway_commands import publish_gateway_command

        publish_gateway_command(gateway.device_id, payload.command, gateway.thing_name)
    return HouseholdStateResponse(state=state)


@router.post("/device", response_model=HouseholdStateResponse)
def post_household_device(
    payload: HouseholdDeviceRequest,
    _auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdStateResponse:
    state = store.apply_household_device(payload.kind, payload.id, payload.on, payload.brightness)
    gateway = store.find_matter_gateway()
    if gateway:
        from homehub_api.iot.gateway_commands import publish_gateway_command, runtime_device_command

        publish_gateway_command(
            gateway.device_id,
            runtime_device_command(payload.kind, payload.id, payload.on, payload.brightness),
            gateway.thing_name,
        )
    return HouseholdStateResponse(state=state)
