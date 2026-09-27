from __future__ import annotations

from fastapi import Request

from homehub_api.auth import AuthContext
from homehub_api.cognito_groups import (
    add_user_to_household_group,
    cognito_username_for,
    global_sign_out,
    remove_user_from_household_group,
)
from homehub_api.errors import ApiError
from homehub_api.household import hash_email, hash_invite_token, household_pk, is_invite_expired
from homehub_api.models import AcceptHouseholdInviteRequest, HouseholdResponse
from homehub_api.services.household import ensure_profile, household_payload, require_owner
from homehub_api.store import HubStore, lookup_invite_by_token_hash


def bootstrap_household(auth: AuthContext, store: HubStore) -> HouseholdResponse:
    profile = ensure_profile(store, auth)
    user_id = str(auth.user_id)
    email = auth.email or str(profile.get("email") or "")
    username = str(profile.get("username") or (email.split("@")[0] if email else "user"))
    household_id = str(profile.get("householdId") or store.household_id or user_id)
    created = False
    if not profile.get("householdId"):
        created = True
        household_id = store.household_id or user_id
        store.put_household_metadata({"ownerUserId": user_id, "householdId": household_id})
        store.put_member(
            {"userId": user_id, "email": email, "role": "OWNER", "householdId": household_id}
        )
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
    elif not store.get_member(user_id):
        store.put_member(
            {
                "userId": user_id,
                "email": email,
                "role": profile.get("role") or "OWNER",
                "householdId": household_id,
            }
        )
    added = add_user_to_household_group(cognito_username_for(profile, email, user_id), household_id)
    return household_payload(
        store,
        role=str(profile.get("role") or "OWNER"),
        created=created,
        token_refresh_required=created or added,
    )


def accept_invite(
    payload: AcceptHouseholdInviteRequest,
    request: Request,
    auth: AuthContext,
    store: HubStore,
) -> HouseholdResponse:
    if not auth.email:
        raise ApiError("Verified email is required to accept an invitation", 403, "Forbidden")
    token_hash = hash_invite_token(payload.token.strip())
    injected = getattr(request.app.state, "store", None)
    lookup = (
        store.get_invite_by_token_hash(token_hash)
        if injected is not None
        else lookup_invite_by_token_hash(str(request.app.state.table_name), token_hash)
    )
    if not lookup:
        raise ApiError("Invitation not found", 404, "NotFound")
    if lookup.get("status") != "pending" or is_invite_expired(lookup.get("expiresAt")):
        raise ApiError("Invitation is no longer valid", 410, "Gone")
    if lookup.get("emailHash") != hash_email(auth.email):
        raise ApiError("This invitation was sent to a different email address", 403, "Forbidden")

    profile = store.get_profile(str(auth.user_id))
    existing_household = str((profile or {}).get("householdId") or "")
    target_household = str(lookup.get("householdId") or "")
    if existing_household and existing_household != target_household:
        raise ApiError("You already belong to a household", 409, "Conflict")
    if existing_household == target_household and profile:
        add_user_to_household_group(
            cognito_username_for(profile, auth.email, str(auth.user_id)),
            target_household,
        )
        return household_payload(store, role=str(profile.get("role") or "MEMBER"))

    household_store = store
    if injected is None:
        household_store = HubStore(
            str(request.app.state.table_name),
            tenant_pk=str(lookup.get("tenantPk") or household_pk(target_household)),
        )
    invite = household_store.get_invite(str(lookup["inviteId"])) or {
        **lookup,
        "inviteId": lookup["inviteId"],
        "emailHash": lookup.get("emailHash"),
        "role": lookup.get("role") or "MEMBER",
        "expiresAt": lookup.get("expiresAt"),
    }
    username = str((profile or {}).get("username") or auth.email.split("@")[0])
    result = household_store.accept_invite_transaction(
        user_id=str(auth.user_id),
        email=auth.email,
        username=username,
        invite=invite,
        token_hash=token_hash,
        profile=profile,
    )
    add_user_to_household_group(
        cognito_username_for(result["profile"], auth.email, str(auth.user_id)),
        target_household,
    )
    if injected is None:
        household_store = HubStore(
            str(request.app.state.table_name),
            tenant_pk=household_pk(target_household),
        )
    return household_payload(
        household_store,
        role=str(result["role"]),
        token_refresh_required=True,
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
