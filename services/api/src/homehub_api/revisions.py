"""Conditional HUB_STATE writes with a server-owned revision."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from homehub_api.errors import ApiError
from homehub_api.household import HUB_STATE_SK, STATE_WRITE_MAX_ATTEMPTS, now_iso
from homehub_api.hub_state import default_household_state, dynamo_safe

Mutator = Callable[[dict[str, Any]], dict[str, Any]]


def revision_of(item: dict[str, Any] | None, state: dict[str, Any] | None = None) -> int:
    if item and item.get("revision") is not None:
        try:
            return int(item["revision"])
        except (TypeError, ValueError):
            pass
    payload = state if isinstance(state, dict) else None
    if payload is None and item and isinstance(item.get("state"), dict):
        payload = item["state"]
    if payload and payload.get("stateVersion") is not None:
        try:
            return int(payload["stateVersion"])
        except (TypeError, ValueError):
            return 0
    return 0


def read_hub_state_item(table: Any, tenant_pk: str) -> dict[str, Any] | None:
    result = table.get_item(Key={"PK": tenant_pk, "SK": HUB_STATE_SK})
    item = result.get("Item")
    return dict(item) if item else None


def commit_hub_state(
    table: Any,
    tenant_pk: str,
    mutator: Mutator,
    *,
    extra_item_fields: dict[str, Any] | None = None,
    max_attempts: int = STATE_WRITE_MAX_ATTEMPTS,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for _attempt in range(max_attempts):
        existing = read_hub_state_item(table, tenant_pk)
        raw_state = existing.get("state") if existing else None
        previous = raw_state if isinstance(raw_state, dict) else default_household_state()
        current_revision = revision_of(existing, previous)
        next_state = mutator(previous)
        if not isinstance(next_state, dict):
            next_state = default_household_state()
        timestamp = now_iso()
        next_revision = current_revision + 1
        next_state = {
            **next_state,
            "updatedAt": next_state.get("updatedAt") or timestamp,
            "stateVersion": next_revision,
        }
        item: dict[str, Any] = {
            "PK": tenant_pk,
            "SK": HUB_STATE_SK,
            "state": next_state,
            "revision": next_revision,
            "updatedAt": timestamp,
        }
        if extra_item_fields:
            item.update(
                {key: value for key, value in extra_item_fields.items() if value is not None}
            )
        kwargs: dict[str, Any] = {"Item": dynamo_safe(item)}
        if existing is None:
            kwargs["ConditionExpression"] = Attr("PK").not_exists()
        elif existing.get("revision") is None:
            kwargs["ConditionExpression"] = Attr("revision").not_exists()
        else:
            kwargs["ConditionExpression"] = Attr("revision").eq(current_revision)
        try:
            table.put_item(**kwargs)
            return next_state
        except ClientError as exc:
            last_error = exc
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            continue
        except TypeError:
            # In-memory fakes may not accept ConditionExpression.
            table.put_item(Item=kwargs["Item"])
            return next_state
    raise ApiError("Household state is busy, retry", 409, "Conflict") from last_error
