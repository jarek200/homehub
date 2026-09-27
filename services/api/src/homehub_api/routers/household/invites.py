from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from ulid import new as new_ulid

from homehub_api.auth import AuthContext, require_auth
from homehub_api.dependencies import get_store
from homehub_api.errors import ApiError
from homehub_api.household import (
    hash_email,
    hash_invite_token,
    invite_expires_at,
    is_invite_expired,
    is_valid_email,
    new_invite_token,
    normalize_email,
    now_iso,
)
from homehub_api.invite_mail import send_invite_email
from homehub_api.models import (
    AcceptHouseholdInviteRequest,
    CreateHouseholdInviteRequest,
    HouseholdInviteResponse,
    HouseholdResponse,
)
from homehub_api.services.household import invite_response, require_owner
from homehub_api.services.household_membership import accept_invite as run_accept_invite
from homehub_api.store import HubStore

router = APIRouter()


@router.post("/invites", response_model=HouseholdInviteResponse)
def create_invite(
    payload: CreateHouseholdInviteRequest,
    auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdInviteResponse:
    user_id = str(auth.user_id)
    require_owner(store, user_id)
    email = normalize_email(payload.email)
    if not is_valid_email(email):
        raise ApiError("A valid email is required", 400, "ValidationError")
    if auth.email and email == auth.email:
        raise ApiError("You are already in this household", 409, "Conflict")
    for member in store.list_members():
        if normalize_email(str(member.get("email") or "")) == email:
            raise ApiError("That person is already a household member", 409, "Conflict")
    for invite in store.list_invites():
        if (
            invite.get("status") == "pending"
            and not is_invite_expired(invite.get("expiresAt"))
            and normalize_email(str(invite.get("email") or "")) == email
        ):
            raise ApiError("An invitation is already pending for that email", 409, "Conflict")
    token = new_invite_token()
    token_hash = hash_invite_token(token)
    timestamp = now_iso()
    record = {
        "inviteId": str(new_ulid()),
        "email": email,
        "emailHash": hash_email(email),
        "role": "MEMBER",
        "status": "pending",
        "expiresAt": invite_expires_at(),
        "createdAt": timestamp,
        "createdBy": user_id,
        "tokenHash": token_hash,
    }
    stored = store.put_invite(record, token_hash=token_hash)
    delivery = send_invite_email(email, token)
    return invite_response(stored, delivery)


@router.post("/invites/{invite_id}/resend", response_model=HouseholdInviteResponse)
def resend_invite(
    invite_id: str,
    auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdInviteResponse:
    require_owner(store, str(auth.user_id))
    invite = store.get_invite(invite_id)
    if not invite or invite.get("status") != "pending":
        raise ApiError("Invitation not found", 404, "NotFound")
    if is_invite_expired(invite.get("expiresAt")):
        raise ApiError("Invitation has expired", 410, "Gone")
    old_hash = str(invite.get("tokenHash") or "")
    token = new_invite_token()
    token_hash = hash_invite_token(token)
    if old_hash:
        store.delete_invite_token(old_hash)
    stored = store.put_invite({**invite, "tokenHash": token_hash}, token_hash=token_hash)
    delivery = send_invite_email(str(invite.get("email") or ""), token)
    return invite_response(stored, delivery)


@router.delete("/invites/{invite_id}", response_model=HouseholdInviteResponse)
def cancel_invite(
    invite_id: str,
    auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdInviteResponse:
    require_owner(store, str(auth.user_id))
    invite = store.get_invite(invite_id)
    if not invite:
        raise ApiError("Invitation not found", 404, "NotFound")
    if invite.get("tokenHash"):
        store.delete_invite_token(str(invite["tokenHash"]))
    stored = store.put_invite({**invite, "status": "cancelled", "tokenHash": None})
    return invite_response(stored)


@router.post("/invites/accept", response_model=HouseholdResponse)
def accept_invite(
    payload: AcceptHouseholdInviteRequest,
    request: Request,
    auth: AuthContext = Depends(require_auth),
    store: HubStore = Depends(get_store),
) -> HouseholdResponse:
    return run_accept_invite(payload, request, auth, store)
