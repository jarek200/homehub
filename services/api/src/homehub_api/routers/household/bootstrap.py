from fastapi import APIRouter, Depends

from homehub_api.auth import AuthContext, require_auth
from homehub_api.dependencies import get_store
from homehub_api.models import HouseholdResponse
from homehub_api.services.household_membership import bootstrap_household as run_bootstrap
from homehub_api.store import HubStore

router = APIRouter()


@router.post("/bootstrap", response_model=HouseholdResponse)
def bootstrap_household(
    auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdResponse:
    return run_bootstrap(auth, store)
