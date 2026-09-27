from __future__ import annotations

from typing import Literal, cast

from homehub_api.auth import AuthContext
from homehub_api.errors import ApiError
from homehub_api.household import now_iso
from homehub_api.models import HouseholdMemberResponse, HouseholdResponse
from homehub_api.store import HubStore


def member_response(item: dict) -> HouseholdMemberResponse:
    return HouseholdMemberResponse(
        userId=str(item.get("userId") or ""),
        email=str(item.get("email") or ""),
        role=item.get("role") or "MEMBER",
        createdAt=str(item.get("createdAt") or now_iso()),
        updatedAt=str(item.get("updatedAt") or now_iso()),
    )


def require_owner(store: HubStore, user_id: str) -> dict:
    member = store.get_member(user_id)
    role = str((member or {}).get("role") or (store.get_profile(user_id) or {}).get("role") or "")
    if role != "OWNER":
        raise ApiError("Only the household owner can manage members", 403, "Forbidden")
    return member or {"userId": user_id, "role": "OWNER"}


def ensure_profile(store: HubStore, auth: AuthContext) -> dict:
    user_id = str(auth.user_id)
    existing = store.get_profile(user_id)
    email = auth.email or str((existing or {}).get("email") or "")
    username = str((existing or {}).get("username") or "")
    if not username and email:
        username = email.split("@")[0]
    if existing:
        return existing
    return store.put_profile(
        user_id,
        {
            "email": email,
            "username": username or "user",
            "name": None,
            "householdId": None,
            "role": None,
        },
    )


def get_household(auth: AuthContext, store: HubStore) -> HouseholdResponse:
    profile = store.get_profile(str(auth.user_id))
    if not profile or not profile.get("householdId"):
        raise ApiError("Household not found", 404, "NotFound")
    return household_payload(store, role=str(profile.get("role") or "MEMBER"))


def household_payload(
    store: HubStore,
    *,
    role: str,
    created: bool = False,
    token_refresh_required: bool = False,
) -> HouseholdResponse:
    return HouseholdResponse(
        householdId=store.household_id,
        role=cast(Literal["OWNER", "MEMBER"], role),
        created=created,
        tokenRefreshRequired=token_refresh_required,
        members=[member_response(item) for item in store.list_members()],
    )
