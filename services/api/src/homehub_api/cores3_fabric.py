"""CoreS3 Matter fabric as registered in HomeHub. Data lives in @homehub/catalog."""

from __future__ import annotations

from typing import Any

from homehub_api.catalog_data import catalog

_CATALOG = catalog()
CORES3_GATEWAY_ID = str(_CATALOG["gatewayId"])
LEGACY_DUMMY_IDS = set(_CATALOG["legacyDummyIds"])
CORES3_FABRIC_DEVICES: list[dict[str, Any]] = list(_CATALOG["fabricDevices"])


def cores3_household_state(now: str) -> dict[str, Any]:
    return {
        "lock": None,
        "lights": [
            {"id": "matter-1", "name": "KAJPLATS", "on": True, "brightness": 100},
            {"id": "matter-11", "name": "KAJPLATS 2", "on": True, "brightness": 100},
        ],
        "plugs": [
            {"id": "matter-9", "name": "GRILLPLATS", "on": True},
            {"id": "matter-10", "name": "GRILLPLATS 2", "on": True},
        ],
        "contacts": [{"id": "matter-5", "name": "MYGGBETT", "state": "CLOSED"}],
        "motions": [{"id": "matter-4", "name": "MYGGSPRAY", "state": "DETECTED"}],
        "climates": [
            {"id": "matter-2", "name": "TIMMERFLOTTE 1"},
            {"id": "matter-3", "name": "TIMMERFLOTTE 2"},
            {"id": "matter-6", "name": "ALPSTUGA"},
        ],
        "leaks": [{"id": "matter-7", "name": "KLIPPBOK", "state": "DRY"}],
        "buttons": [],
        "scene": "home",
        "updatedAt": now,
    }


def empty_household_state(now: str) -> dict[str, Any]:
    return {
        "lock": None,
        "lights": [],
        "plugs": [],
        "contacts": [],
        "motions": [],
        "climates": [],
        "leaks": [],
        "buttons": [],
        "scene": None,
        "updatedAt": now,
    }


def _ids_from_state(state: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    lock = state.get("lock")
    if isinstance(lock, dict) and lock.get("id"):
        ids.append(str(lock["id"]))
    for key in ("lights", "plugs", "contacts", "motions", "leaks", "buttons"):
        items = state.get(key)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict) and item.get("id"):
                ids.append(str(item["id"]))
    return ids


def is_legacy_dummy_household_state(state: Any) -> bool:
    if not isinstance(state, dict):
        return False
    return any(item_id in LEGACY_DUMMY_IDS for item_id in _ids_from_state(state))
