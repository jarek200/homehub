"""Known IKEA Matter products. Data lives in @homehub/catalog."""

from __future__ import annotations

from typing import Any

from homehub_api.catalog_data import catalog

_CATALOG = catalog()
CORES3_RESERVED_NODE_IDS = set(_CATALOG["reservedNodeIds"])
CORES3_PRODUCTS: list[dict[str, Any]] = list(_CATALOG["products"])


HOUSEHOLD_KEYS = {
    "light": "lights",
    "plug": "plugs",
    "contact": "contacts",
    "motion": "motions",
    "climate": "climates",
    "leak": "leaks",
    "button": "buttons",
}

TYPE_TO_HOUSEHOLD = {
    "light": "light",
    "plug": "plug",
    "contact-sensor": "contact",
    "motion-sensor": "motion",
    "environmental-sensor": "climate",
    "leak-sensor": "leak",
    "button": "button",
}

CLUSTER_ATTR = {
    "onoff": (0x0006, 0),
    "level": (0x0008, 0),
    "boolean-state": (0x0045, 0),
    "illuminance": (0x0400, 0),
    "temperature": (0x0402, 0),
    "humidity": (0x0405, 0),
    "occupancy": (0x0406, 0),
    "co2": (0x040D, 0),
    "air-quality": (0x005B, 0),
    "pm25": (0x042A, 0),
    "battery": (0x002F, 0x000C),
}


def product_by_id(product_id: str) -> dict[str, Any] | None:
    for product in CORES3_PRODUCTS:
        if product["productId"] == product_id:
            return product
    return None


def next_product_name(base: str, existing_names: list[str]) -> str:
    names = {name.strip().lower() for name in existing_names}
    if base.lower() not in names:
        return base
    index = 2
    while f"{base} {index}".lower() in names:
        index += 1
    return f"{base} {index}"


def next_matter_device_id(existing_ids: list[str]) -> str:
    max_n = 0
    for device_id in existing_ids:
        if not device_id.startswith("matter-"):
            continue
        suffix = device_id.removeprefix("matter-")
        if suffix.isdigit():
            max_n = max(max_n, int(suffix))
    return f"matter-{max_n + 1}"


def next_matter_node_id(existing_node_ids: list[int | None]) -> int:
    used = set(CORES3_RESERVED_NODE_IDS)
    for node_id in existing_node_ids:
        if isinstance(node_id, int) and node_id >= 1:
            used.add(node_id)
    next_id = 1
    while next_id in used:
        next_id += 1
    return next_id


def match_product(device_type: str, clusters: list[str] | None) -> dict[str, Any] | None:
    cluster_set = set(clusters or [])
    matches = [
        product
        for product in CORES3_PRODUCTS
        if product["type"] == device_type and set(product["clusters"]) == cluster_set
    ]
    if len(matches) == 1:
        return matches[0]
    if matches:
        return matches[0]
    for product in CORES3_PRODUCTS:
        if product["type"] == device_type:
            return product
    return None


def household_kind_for_device(device_type: str, clusters: list[str] | None) -> str:
    product = match_product(device_type, clusters)
    if product:
        return str(product["household"])
    return TYPE_TO_HOUSEHOLD.get(device_type, "climate")


def household_card(household: str, device_id: str, name: str) -> dict[str, Any]:
    if household == "light":
        return {"id": device_id, "name": name, "on": True, "brightness": 100}
    if household == "plug":
        return {"id": device_id, "name": name, "on": True}
    if household == "contact":
        return {"id": device_id, "name": name, "state": "CLOSED"}
    if household == "motion":
        return {"id": device_id, "name": name, "state": "DETECTED"}
    if household == "leak":
        return {"id": device_id, "name": name, "state": "DRY"}
    if household == "button":
        return {"id": device_id, "name": name}
    return {"id": device_id, "name": name}


def fabric_reads(
    product: dict[str, Any] | None, endpoint: int, clusters: list[str]
) -> list[dict[str, int]]:
    overrides = product.get("clusterEndpoints") if product else None
    overrides = overrides if isinstance(overrides, dict) else {}
    reads: list[dict[str, int]] = []
    for cluster in clusters:
        mapped = CLUSTER_ATTR.get(cluster)
        if not mapped:
            continue
        cluster_id, attr = mapped
        reads.append(
            {
                "e": int(overrides.get(cluster, endpoint)),
                "c": cluster_id,
                "a": attr,
            }
        )
    if not reads:
        reads.append({"e": endpoint or 1, "c": 0x0006, "a": 0})
    return reads


def upsert_household_item(
    state: dict[str, Any], household: str, card: dict[str, Any]
) -> dict[str, Any]:
    key = HOUSEHOLD_KEYS[household]
    items = [item for item in list(state.get(key) or []) if isinstance(item, dict)]
    next_items = [item for item in items if item.get("id") != card["id"]]
    previous = next((item for item in items if item.get("id") == card["id"]), None)
    next_items.append({**(previous or {}), **card})
    return {**state, key: next_items}


def remove_household_item(state: dict[str, Any], device_id: str) -> dict[str, Any]:
    next_state = dict(state)
    for key in HOUSEHOLD_KEYS.values():
        items = next_state.get(key)
        if not isinstance(items, list):
            continue
        next_state[key] = [
            item for item in items if not (isinstance(item, dict) and item.get("id") == device_id)
        ]
    lock = next_state.get("lock")
    if isinstance(lock, dict) and lock.get("id") == device_id:
        next_state["lock"] = None
    return next_state
