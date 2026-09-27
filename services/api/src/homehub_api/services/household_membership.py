from __future__ import annotations

from homehub_api.auth import AuthContext
from homehub_api.cognito_groups import (
    add_user_to_household_group,
    cognito_username_for,
    global_sign_out,
    remove_user_from_household_group,
)
from homehub_api.errors import ApiError
from homehub_api.models import HouseholdResponse
from homehub_api.services.household import ensure_profile, household_payload, require_owner
from homehub_api.store import HubStore


def _owner_member(user_id: str, email: str, household_id: str) -> dict[str, str]:
    return {"userId": user_id, "email": email, "role": "OWNER", "householdId": household_id}


def bootstrap_household(auth: AuthContext, store: HubStore) -> HouseholdResponse:
    profile = ensure_profile(store, auth)
    user_id = str(auth.user_id)
    email = auth.email or str(profile.get("email") or "")
    username = str(profile.get("username") or (email.split("@")[0] if email else "user"))
    created = False
    household_id = str(profile.get("householdId") or "")
    if household_id:
        if not store.get_member(user_id):
            store.put_member(
                {
                    "userId": user_id,
                    "email": email,
                    "role": profile.get("role") or "OWNER",
                    "householdId": household_id,
                }
            )
    else:
        metadata = store.get_household_metadata()
        if metadata:
            household_id = str(metadata.get("householdId") or store.household_id)
        else:
            created = True
            household_id = store.household_id or user_id
            store.put_household_metadata({"ownerUserId": user_id, "householdId": household_id})
        store.put_member(_owner_member(user_id, email, household_id))
        profile = store.put_profile(
            user_id,
            {
                **profile,
                "householdId": household_id,
                "role": "OWNER",
                "email": email,
                "username": username,
            },
        )
    store.put_home_pointer(household_id)
    added = add_user_to_household_group(cognito_username_for(profile, email, user_id), household_id)
    return household_payload(
        store,
        role=str(profile.get("role") or "OWNER"),
        created=created,
        token_refresh_required=created or added,
    )


def remove_member(member_id: str, auth: AuthContext, store: HubStore) -> HouseholdResponse:
    require_owner(store, str(auth.user_id))
    if member_id == auth.user_id:
        raise ApiError("The owner cannot be removed", 400, "ValidationError")
    member = store.get_member(member_id)
    if not member:
        raise ApiError("Member not found", 404, "NotFound")
    if member.get("role") == "OWNER":
        raise ApiError("The owner cannot be removed", 400, "ValidationError")
    store.delete_member(member_id)
    profile = store.get_profile(member_id)
    if profile:
        store.put_profile(member_id, {**profile, "householdId": None, "role": None})
    username = cognito_username_for(profile, str(member.get("email") or ""), member_id)
    remove_user_from_household_group(username, store.household_id)
    global_sign_out(username)
    owner = store.get_profile(str(auth.user_id)) or {}
    return household_payload(store, role=str(owner.get("role") or "OWNER"))
