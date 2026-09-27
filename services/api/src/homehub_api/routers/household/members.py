from fastapi import APIRouter, Depends

from homehub_api.auth import AuthContext, require_auth
from homehub_api.dependencies import get_store
from homehub_api.models import HouseholdResponse
from homehub_api.services.household import get_household
from homehub_api.services.household_membership import remove_member as run_remove_member
from homehub_api.store import HubStore

router = APIRouter()


@router.get("/members", response_model=HouseholdResponse)
def list_household_members(
    auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdResponse:
    return get_household(auth, store)


@router.delete("/members/{member_id}", response_model=HouseholdResponse)
def remove_member(
    member_id: str,
    auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdResponse:
    return run_remove_member(member_id, auth, store)
