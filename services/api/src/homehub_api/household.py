"""Household keys, membership roles, invitations, and tenant resolution."""

from __future__ import annotations

import hashlib
import os
import re
import secrets
from datetime import UTC, datetime
from typing import Any

HOUSEHOLD_PREFIX = "HOUSEHOLD#"
USER_PREFIX = "USER#"
GATEWAY_PREFIX = "GATEWAY#"
INVITE_PREFIX = "INVITE#"

HOUSEHOLD_METADATA_SK = "METADATA"
HOUSEHOLD_LOOKUP_SK = "HOUSEHOLD"
HUB_STATE_SK = "HUB_STATE"
HUB_RULES_SK = "HUB_RULES"
PROFILE_SK = "PROFILE"
MEMBER_SK_PREFIX = "MEMBER#"
INVITE_SK_PREFIX = "INVITE#"
DEVICE_SK_PREFIX = "DEVICE#"

INVITE_TTL_SECONDS = 7 * 24 * 60 * 60
STATE_WRITE_MAX_ATTEMPTS = 5

DEMO_TENANT_ID = "demo"
DEMO_TENANT_PK = f"{HOUSEHOLD_PREFIX}{DEMO_TENANT_ID}"

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def household_pk(household_id: str) -> str:
    return f"{HOUSEHOLD_PREFIX}{household_id}"


def device_sk(device_id: str) -> str:
    return f"{DEVICE_SK_PREFIX}{device_id}"


def user_pk(user_id: str) -> str:
    return f"{USER_PREFIX}{user_id}"


def gateway_pk(gateway_id: str) -> str:
    return f"{GATEWAY_PREFIX}{gateway_id}"


def invite_pk(token_hash: str) -> str:
    return f"{INVITE_PREFIX}{token_hash}"


def member_sk(user_id: str) -> str:
    return f"{MEMBER_SK_PREFIX}{user_id}"


def invite_sk(invite_id: str) -> str:
    return f"{INVITE_SK_PREFIX}{invite_id}"


def is_household_pk(tenant_pk: str) -> bool:
    return tenant_pk.startswith(HOUSEHOLD_PREFIX)


def household_id_from_pk(tenant_pk: str) -> str:
    if is_household_pk(tenant_pk):
        return tenant_pk.removeprefix(HOUSEHOLD_PREFIX)
    return tenant_pk


def normalize_tenant_pk(value: str | None, *, default: str | None = None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return default or DEMO_TENANT_PK
    if is_household_pk(raw):
        return raw
    return household_pk(raw)


def cognito_household_group(household_id: str) -> str:
    return f"hh_{household_id}"


def normalize_cognito_groups(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, str) and item]
    if not isinstance(raw, str):
        return []
    trimmed = raw.strip()
    if not trimmed:
        return []
    if trimmed.startswith("[") and trimmed.endswith("]"):
        inner = trimmed[1:-1].strip()
        if not inner:
            return []
        parts = [part.strip().strip("\"'") for part in inner.split(",")]
        return [part for part in parts if part]
    return [part.strip() for part in trimmed.split(",") if part.strip()]


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(normalize_email(email)))


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_email(email: str) -> str:
    return hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()


def new_invite_token() -> str:
    return secrets.token_urlsafe(32)


def invite_expires_at(*, now: datetime | None = None, ttl_seconds: int = INVITE_TTL_SECONDS) -> int:
    stamp = now or datetime.now(UTC)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return int(stamp.timestamp()) + ttl_seconds


def is_invite_expired(expires_at: Any, *, now: datetime | None = None) -> bool:
    try:
        deadline = int(expires_at)
    except (TypeError, ValueError):
        return True
    stamp = now or datetime.now(UTC)
    return deadline <= int(stamp.timestamp())


def channel_for_household_pk(tenant_pk: str) -> str | None:
    if not is_household_pk(tenant_pk):
        return None
    household_id = household_id_from_pk(tenant_pk)
    return f"household/{household_id}" if household_id else None


def app_url() -> str:
    return (os.environ.get("APP_URL") or os.environ.get("VITE_APP_URL") or "").rstrip("/")


def ses_from_address() -> str:
    return (os.environ.get("SES_FROM_ADDRESS") or "").strip()


def get_profile_item(table: Any, user_id: str) -> dict[str, Any] | None:
    result = table.get_item(Key={"PK": user_pk(user_id), "SK": PROFILE_SK})
    item = result.get("Item")
    return dict(item) if item else None


def get_gateway_household_item(table: Any, gateway_id: str) -> dict[str, Any] | None:
    result = table.get_item(Key={"PK": gateway_pk(gateway_id), "SK": HOUSEHOLD_LOOKUP_SK})
    item = result.get("Item")
    return dict(item) if item else None


def resolve_household_pk_for_user(table: Any, user_id: str | None) -> str:
    if not user_id:
        return resolve_demo_pk(table)
    profile = get_profile_item(table, user_id)
    household_id = str(profile.get("householdId") or "") if profile else ""
    return household_pk(household_id or user_id)


def resolve_demo_pk(table: Any) -> str:
    return DEMO_TENANT_PK


def resolve_household_pk_for_gateway(
    table: Any,
    gateway_id: str | None,
    event_hub_id: str | None = None,
) -> str:
    if gateway_id:
        lookup = get_gateway_household_item(table, gateway_id)
        if lookup:
            household_id = str(lookup.get("householdId") or "")
            tenant_pk = str(lookup.get("tenantPk") or "")
            if household_id:
                return household_pk(household_id)
            if tenant_pk:
                return normalize_tenant_pk(tenant_pk)
    hid = household_id_from_pk(str(event_hub_id or DEMO_TENANT_ID))
    return household_pk(hid)


def snapshot_prefixes(
    device_id: str, household_id: str | None = None, thing_name: str | None = None
) -> list[str]:
    prefixes: list[str] = []
    if household_id:
        prefixes.append(f"snapshots/{household_id}/{device_id}/")
    camera_thing = (thing_name or "").strip() or f"homehub-{device_id}"
    thing_prefix = f"snapshots/{camera_thing}/"
    if thing_prefix not in prefixes:
        prefixes.append(thing_prefix)
    return prefixes
