"""CoreS3 Matter fabric as registered in HomeHub. Data lives in @homehub/catalog."""

from __future__ import annotations

from typing import Any

from homehub_api.catalog_data import catalog

_CATALOG = catalog()
CORES3_GATEWAY_ID = str(_CATALOG["gatewayId"])
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
