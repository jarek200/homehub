"""Device registry partition.

Writes use DEVICE_REGISTRY. Reads still check SIMULATOR so a stage can be
backfilled before its writers switch over.
"""

from __future__ import annotations

from typing import Any

REGISTRY_PK = "DEVICE_REGISTRY"
LEGACY_REGISTRY_PK = "SIMULATOR"


def registry_key(device_id: str, pk: str = REGISTRY_PK) -> dict[str, str]:
    return {"PK": pk, "SK": f"DEVICE#{device_id}"}


def get_registry_item(table: Any, device_id: str) -> dict[str, Any] | None:
    for pk in (REGISTRY_PK, LEGACY_REGISTRY_PK):
        item = table.get_item(Key=registry_key(device_id, pk)).get("Item")
        if item:
            return dict(item)
    return None


def delete_registry_items(table: Any, device_id: str) -> None:
    for pk in (REGISTRY_PK, LEGACY_REGISTRY_PK):
        table.delete_item(Key=registry_key(device_id, pk))
