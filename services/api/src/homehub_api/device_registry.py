"""Device registry partition. One row per provisioned device."""

from __future__ import annotations

from typing import Any

REGISTRY_PK = "DEVICE_REGISTRY"


def registry_key(device_id: str) -> dict[str, str]:
    return {"PK": REGISTRY_PK, "SK": f"DEVICE#{device_id}"}


def get_registry_item(table: Any, device_id: str) -> dict[str, Any] | None:
    item = table.get_item(Key=registry_key(device_id)).get("Item")
    return dict(item) if item else None


def delete_registry_items(table: Any, device_id: str) -> None:
    table.delete_item(Key=registry_key(device_id))
