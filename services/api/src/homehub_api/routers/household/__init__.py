from fastapi import APIRouter, Depends

from homehub_api.auth import AuthContext, require_auth
from homehub_api.dependencies import get_store
from homehub_api.models import HouseholdResponse
from homehub_api.services.household import get_household as read_household
from homehub_api.store import HubStore

from . import bootstrap, invites, members, plan, rules, sensor_events, state

router = APIRouter(prefix="/household", tags=["household"])


@router.get("", response_model=HouseholdResponse)
def get_household(
    auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdResponse:
    return read_household(auth, store)


router.include_router(bootstrap.router)
router.include_router(sensor_events.router)
router.include_router(members.router)
router.include_router(invites.router)
router.include_router(state.router)
router.include_router(plan.router)
router.include_router(rules.router)
