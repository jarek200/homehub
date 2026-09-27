from fastapi import APIRouter, Depends, Response

from homehub_api.auth import AuthContext, require_auth
from homehub_api.dependencies import get_store
from homehub_api.errors import ApiError
from homehub_api.models import HouseholdPlanRequest, HouseholdPlanResponse
from homehub_api.store import HubStore

router = APIRouter()


@router.get("/plan", response_model=HouseholdPlanResponse)
def get_household_plan(
    response: Response,
    _auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdPlanResponse:
    response.headers["Cache-Control"] = "no-store"
    plan, library = store.get_floor_plan_document()
    return HouseholdPlanResponse(plan=plan, library=library)


@router.put("/plan", response_model=HouseholdPlanResponse)
def put_household_plan(
    payload: HouseholdPlanRequest,
    _auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdPlanResponse:
    plan = payload.plan
    if not isinstance(plan.get("rooms"), list) or not isinstance(plan.get("width"), (int, float)):
        raise ApiError("Invalid floor plan", 400, "ValidationError")
    gateway = store.find_matter_gateway()
    if gateway:
        from homehub_api.iot.gateway_commands import compact_runtime_plan

        try:
            compact_runtime_plan(plan)
        except ValueError as exc:
            raise ApiError(str(exc), 400, "PlanTooLarge") from exc
    stored = store.put_floor_plan(plan, payload.library)
    if gateway:
        from homehub_api.iot.gateway_commands import publish_gateway_plan

        publish_gateway_plan(gateway.device_id, stored)
    return HouseholdPlanResponse(plan=stored, library=store.get_floor_plan_library())
