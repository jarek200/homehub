"""Household keys, membership roles, and tenant resolution."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

from botocore.exceptions import ClientError

HOUSEHOLD_PREFIX = "HOUSEHOLD#"
USER_PREFIX = "USER#"
GATEWAY_PREFIX = "GATEWAY#"

HOUSEHOLD_METADATA_SK = "METADATA"
HOUSEHOLD_LOOKUP_SK = "HOUSEHOLD"
HOME_POINTER_PK = "HOMEHUB#HOME"
HOME_POINTER_SK = "HOUSEHOLD"
HUB_STATE_SK = "HUB_STATE"
HUB_RULES_SK = "HUB_RULES"
PROFILE_SK = "PROFILE"
MEMBER_SK_PREFIX = "MEMBER#"
DEVICE_SK_PREFIX = "DEVICE#"

STATE_WRITE_MAX_ATTEMPTS = 5

DEMO_TENANT_ID = "demo"
DEMO_TENANT_PK = f"{HOUSEHOLD_PREFIX}{DEMO_TENANT_ID}"


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


def member_sk(user_id: str) -> str:
    return f"{MEMBER_SK_PREFIX}{user_id}"


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


def channel_for_household_pk(tenant_pk: str) -> str | None:
    if not is_household_pk(tenant_pk):
        return None
    household_id = household_id_from_pk(tenant_pk)
    return f"household/{household_id}" if household_id else None


def app_url() -> str:
    return (os.environ.get("APP_URL") or os.environ.get("VITE_APP_URL") or "").rstrip("/")


def get_profile_item(table: Any, user_id: str) -> dict[str, Any] | None:
    result = table.get_item(Key={"PK": user_pk(user_id), "SK": PROFILE_SK})
    item = result.get("Item")
    return dict(item) if item else None


def get_gateway_household_item(table: Any, gateway_id: str) -> dict[str, Any] | None:
    result = table.get_item(Key={"PK": gateway_pk(gateway_id), "SK": HOUSEHOLD_LOOKUP_SK})
    item = result.get("Item")
    return dict(item) if item else None


def _pointer_household_id(table: Any) -> str:
    result = table.get_item(Key={"PK": HOME_POINTER_PK, "SK": HOME_POINTER_SK})
    item = result.get("Item") or {}
    return str(item.get("householdId") or "")


def _remember_home_pointer(table: Any, household_id: str) -> str:
    existing = _pointer_household_id(table)
    if existing:
        return existing
    try:
        table.put_item(
            Item={
                "PK": HOME_POINTER_PK,
                "SK": HOME_POINTER_SK,
                "householdId": household_id,
            },
            ConditionExpression="attribute_not_exists(PK)",
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
    return _pointer_household_id(table) or household_id


def _metadata_household_ids(table: Any) -> list[str]:
    found: list[str] = []
    start_key: dict[str, Any] | None = None
    while True:
        kwargs: dict[str, Any] = {}
        if start_key:
            kwargs["ExclusiveStartKey"] = start_key
        page = table.scan(**kwargs)
        for item in page.get("Items") or []:
            pk = str(item.get("PK") or "")
            if item.get("SK") != HOUSEHOLD_METADATA_SK or not pk.startswith(HOUSEHOLD_PREFIX):
                continue
            household_id = str(item.get("householdId") or pk.removeprefix(HOUSEHOLD_PREFIX))
            if household_id:
                found.append(household_id)
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return found


def _choose_household_id(candidates: list[str]) -> str:
    unique = list(dict.fromkeys(candidates))
    non_demo = [item for item in unique if item != DEMO_TENANT_ID]
    pool = non_demo or unique
    return sorted(pool)[0] if pool else ""


def find_existing_household_id(table: Any) -> str:
    """The home already in this stage, remembered as HOMEHUB#HOME / HOUSEHOLD."""
    pointer = _pointer_household_id(table)
    if pointer:
        return pointer
    chosen = _choose_household_id(_metadata_household_ids(table))
    if not chosen:
        return ""
    return _remember_home_pointer(table, chosen)


def resolve_household_pk_for_user(table: Any, user_id: str | None) -> str:
    if not user_id:
        return resolve_demo_pk(table)
    profile = get_profile_item(table, user_id)
    household_id = str(profile.get("householdId") or "") if profile else ""
    if household_id:
        return household_pk(household_id)
    existing = find_existing_household_id(table)
    return household_pk(existing or user_id)


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
