from fastapi import APIRouter, Depends

from homehub_api.auth import AuthContext, require_auth
from homehub_api.dependencies import get_store
from homehub_api.models import HouseholdRulesRequest, HouseholdRulesResponse
from homehub_api.store import HubStore

router = APIRouter()


@router.get("/rules", response_model=HouseholdRulesResponse)
def get_household_rules(
    _auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdRulesResponse:
    return HouseholdRulesResponse(rules=store.get_hub_rules())


@router.put("/rules", response_model=HouseholdRulesResponse)
def put_household_rules(
    payload: HouseholdRulesRequest,
    _auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdRulesResponse:
    return HouseholdRulesResponse(rules=store.put_hub_rules(payload.rules))
