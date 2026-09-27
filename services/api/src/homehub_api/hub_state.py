"""Live household snapshot used by the HomeHub plan and device pages."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from homehub_api.cores3_fabric import cores3_household_state, empty_household_state
from homehub_api.cores3_products import HOUSEHOLD_KEYS, TYPE_TO_HOUSEHOLD

HUB_STATE_SK = "HUB_STATE"
FLOOR_PLAN_SK = "FLOOR_PLAN"


def upsert_plan_library(library: dict[str, Any] | None, plan: dict[str, Any]) -> dict[str, Any]:
    """Keep every home drawing, and point activePlanId at the plan being saved."""
    plan_id = plan.get("id")
    plans: list[Any] = []
    replaced = False
    for item in (library or {}).get("plans") or []:
        if isinstance(item, dict) and item.get("id") == plan_id:
            plans.append(plan)
            replaced = True
        elif isinstance(item, dict):
            plans.append(item)
    if not replaced:
        plans.append(plan)
    return {
        "activePlanId": plan_id or (library or {}).get("activePlanId"),
        "plans": plans,
        "updatedAt": (library or {}).get("updatedAt"),
    }


def dynamo_json(value: Any) -> Any:
    return json.loads(json.dumps(value), parse_float=Decimal)


def jsonable_plan(value: Any) -> Any:
    return json.loads(json.dumps(value, default=_decimal_default))


def _decimal_default(value: Any) -> float | int:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def dynamo_safe(value: Any) -> Any:
    """Drop None and convert floats so boto3 put_item accepts the document."""
    if isinstance(value, dict):
        return {key: dynamo_safe(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [dynamo_safe(item) for item in value]
    if isinstance(value, float):
        return Decimal(str(value))
    return value


def default_household_state(now: str | None = None) -> dict[str, Any]:
    return cores3_household_state(now or _now_iso())


def normalize_household_state(state: dict[str, Any]) -> dict[str, Any]:
    updated_at = state.get("updatedAt")
    empty = empty_household_state(updated_at if isinstance(updated_at, str) else _now_iso())
    next_state = {**empty, **state}
    for key in ("lights", "plugs", "contacts", "motions", "climates", "leaks", "buttons"):
        if not isinstance(next_state.get(key), list):
            next_state[key] = []
    if next_state.get("lock") is not None and not isinstance(next_state.get("lock"), dict):
        next_state["lock"] = None
    return next_state


def _incoming_household_owner(incoming: dict[str, Any]) -> dict[str, str]:
    owner: dict[str, str] = {}
    for key in HOUSEHOLD_KEYS.values():
        items = incoming.get(key)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict) and item.get("id"):
                owner[str(item["id"])] = key
    return owner


def merge_household_state(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """Update live cards from the gateway without dropping website-added devices."""
    merged = {**existing, **incoming}
    incoming_owner = _incoming_household_owner(incoming)
    for key in HOUSEHOLD_KEYS.values():
        incoming_items = incoming.get(key)
        existing_items = existing.get(key)
        if not isinstance(incoming_items, list):
            merged[key] = existing_items if isinstance(existing_items, list) else []
            continue
        by_id: dict[str, dict[str, Any]] = {}
        if isinstance(existing_items, list):
            for item in existing_items:
                if isinstance(item, dict) and item.get("id"):
                    by_id[str(item["id"])] = dict(item)
        ordered: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in incoming_items:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            item_id = str(item["id"])
            by_id[item_id] = {**by_id.get(item_id, {}), **item}
            ordered.append(by_id[item_id])
            seen.add(item_id)
        if isinstance(existing_items, list):
            for item in existing_items:
                if not isinstance(item, dict) or not item.get("id"):
                    continue
                item_id = str(item["id"])
                if item_id in seen:
                    continue
                owner = incoming_owner.get(item_id)
                if owner is not None and owner != key:
                    continue
                ordered.append(by_id[item_id])
                seen.add(item_id)
        merged[key] = ordered
    return merged


def drop_mismatched_household_cards(
    state: dict[str, Any], device_types: dict[str, str]
) -> dict[str, Any]:
    """Drop leftover cards whose live device belongs in a different household list."""
    key_for_type = {
        device_type: HOUSEHOLD_KEYS[household]
        for device_type, household in TYPE_TO_HOUSEHOLD.items()
        if household in HOUSEHOLD_KEYS
    }
    next_state = dict(state)
    for key in HOUSEHOLD_KEYS.values():
        items = next_state.get(key)
        if not isinstance(items, list):
            continue
        kept: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            expected = key_for_type.get(device_types.get(str(item["id"]), ""))
            if expected and expected != key:
                continue
            kept.append(item)
        next_state[key] = kept
    return next_state


def apply_hub_command(state: dict[str, Any], command: str) -> dict[str, Any]:
    next_state = deepcopy(state)
    next_state["updatedAt"] = _now_iso()
    lights = list(next_state.get("lights") or [])
    lock = next_state.get("lock")
    lock = dict(lock) if isinstance(lock, dict) else None

    if command == "all-lights-off":
        next_state["lights"] = [{**light, "on": False} for light in lights]
        if next_state.get("scene") == "evening":
            next_state["scene"] = "home"
        return next_state

    if command == "all-plugs-off":
        plugs = list(next_state.get("plugs") or [])
        next_state["plugs"] = [{**plug, "on": False} for plug in plugs]
        return next_state

    if command == "lock-house":
        if lock is not None:
            lock["state"] = "LOCKED"
            next_state["lock"] = lock
        return next_state

    if command == "unlock-house":
        if lock is not None:
            lock["state"] = "UNLOCKED"
            next_state["lock"] = lock
        return next_state

    if command == "evening":
        if lock is not None:
            lock["state"] = "LOCKED"
            next_state["lock"] = lock
        next_state["lights"] = [{**light, "on": True, "brightness": 40} for light in lights]
        next_state["scene"] = "evening"
        return next_state

    if command == "home":
        next_state["scene"] = "home"
        return next_state

    if command == "away":
        if lock is not None:
            lock["state"] = "LOCKED"
            next_state["lock"] = lock
        next_state["scene"] = "away"
        return next_state

    return next_state


def apply_hub_device(
    state: dict[str, Any],
    kind: str,
    device_id: str,
    on: bool | None = None,
    brightness: int | None = None,
) -> dict[str, Any]:
    next_state = deepcopy(state)
    next_state["updatedAt"] = _now_iso()
    if kind == "light":
        lights: list[dict[str, Any]] = []
        for light in next_state.get("lights") or []:
            if not isinstance(light, dict) or light.get("id") != device_id:
                lights.append(light)
                continue
            item = dict(light)
            if brightness is not None:
                bri = max(0, min(100, int(brightness)))
                item["brightness"] = bri
                item["on"] = bri > 0 if on is None else bool(on)
            elif on is not None:
                item["on"] = bool(on)
                if on and not item.get("brightness"):
                    item["brightness"] = 100
            lights.append(item)
        next_state["lights"] = lights
        return next_state
    if kind == "plug":
        plugs: list[dict[str, Any]] = []
        for plug in next_state.get("plugs") or []:
            if not isinstance(plug, dict) or plug.get("id") != device_id:
                plugs.append(plug)
                continue
            item = dict(plug)
            if on is not None:
                item["on"] = bool(on)
            plugs.append(item)
        next_state["plugs"] = plugs
    return next_state
