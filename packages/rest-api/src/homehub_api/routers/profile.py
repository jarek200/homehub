from fastapi import APIRouter, Depends

from homehub_api.auth import require_user
from homehub_api.dependencies import get_store
from homehub_api.errors import ApiError
from homehub_api.models import UserResponse
from homehub_api.store import HubStore

router = APIRouter(prefix="/me", tags=["profile"])


def _to_user(item: dict) -> UserResponse:
    email = str(item.get("email") or "")
    username = str(item.get("username") or "")
    if not username and email:
        username = email.split("@")[0] if "@" in email else "user"
    return UserResponse(
        userId=str(item.get("userId") or item.get("PK", "").removeprefix("USER#")),
        username=username,
        email=email,
        name=item.get("name"),
        bio=item.get("bio"),
        avatar=item.get("avatar"),
        createdAt=str(item["createdAt"]),
        updatedAt=str(item["updatedAt"]),
    )


@router.get("", response_model=UserResponse)
def get_profile(
    user_id: str = Depends(require_user),
    store: HubStore = Depends(get_store),
) -> UserResponse:
    item = store.get_profile(user_id)
    if not item:
        raise ApiError("User profile not found", 404, "NotFound")
    return _to_user(item)
