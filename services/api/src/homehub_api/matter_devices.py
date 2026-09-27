"""Add a known Matter product from the HomeHub website."""

from __future__ import annotations

from typing import Any

from homehub_api.cores3_fabric import CORES3_GATEWAY_ID
from homehub_api.cores3_products import (
    fabric_reads,
    household_card,
    household_kind_for_device,
    match_product,
    next_matter_device_id,
    next_matter_node_id,
    next_product_name,
    product_by_id,
)
from homehub_api.errors import ApiError
from homehub_api.models import CreateDeviceRequest, DeviceResponse


def _known_devices(store: Any) -> list[DeviceResponse]:
    devices = list(store.list_all_devices())
    table = getattr(store, "_table", None)
    table_name = getattr(store, "table_name", None)
    if table is None or not table_name:
        return devices
    from homehub_api.iot.gateway_state import tenant_pks_for_gateway
    from homehub_api.store import HubStore

    seen = {device.device_id for device in devices}
    for pk in tenant_pks_for_gateway(table):
        if pk == getattr(store, "tenant_pk", None):
            continue
        for device in HubStore(table_name, tenant_pk=pk).list_all_devices():
            if device.device_id in seen:
                continue
            devices.append(device)
            seen.add(device.device_id)
    return devices


def devices_for_gateway(store: Any, gateway_id: str) -> list[DeviceResponse]:
    gateway = (gateway_id or "").strip() or CORES3_GATEWAY_ID
    return [
        device
        for device in _known_devices(store)
        if device.runtime_kind == "matter" and (device.gateway_id or CORES3_GATEWAY_ID) == gateway
    ]


def _replicate_matter_device(
    store: Any,
    payload: CreateDeviceRequest,
    device: DeviceResponse,
    household: str,
) -> None:
    table = getattr(store, "_table", None)
    table_name = getattr(store, "table_name", None)
    if table is None or not table_name:
        return
    from homehub_api.iot.gateway_state import tenant_pks_for_gateway
    from homehub_api.store import HubStore

    card = household_card(household, device.device_id, device.name)
    for pk in tenant_pks_for_gateway(table):
        if pk == getattr(store, "tenant_pk", None):
            continue
        other = HubStore(table_name, tenant_pk=pk)
        if other.get_device(device.device_id) is None:
            other.create_device(payload, device_id=device.device_id)
        other.add_household_device(household, card)


def add_matter_product(
    store: Any,
    *,
    product_id: str,
    name: str | None,
    location: str | None,
    gateway_id: str | None = None,
    node_id: int | None = None,
) -> DeviceResponse:
    product = product_by_id(product_id)
    if product is None:
        raise ApiError("Unknown Matter product", 400, "ValidationError")

    gateway = (gateway_id or "").strip() or CORES3_GATEWAY_ID
    devices = _known_devices(store)
    existing = next(
        (
            device
            for device in devices
            if device.runtime_kind == "matter"
            and device.node_id == node_id
            and (device.gateway_id or CORES3_GATEWAY_ID) == gateway
        ),
        None,
    )
    if existing is not None and node_id is not None:
        return existing
    device_id = next_matter_device_id([device.device_id for device in devices])
    allocated_node = (
        node_id
        if node_id is not None
        else next_matter_node_id([device.node_id for device in devices_for_gateway(store, gateway)])
    )
    device_name = (name or "").strip() or next_product_name(
        str(product["name"]),
        [device.name for device in devices],
    )
    payload = CreateDeviceRequest(
        name=device_name,
        type=product["type"],
        location=(location or "").strip() or "Home",
        runtimeKind="matter",
        gatewayId=gateway,
        nodeId=allocated_node,
        endpoint=int(product["endpoint"]),
        clusters=list(product["clusters"]),
    )
    device = store.create_device(payload, device_id=device_id)
    household = str(product["household"])
    store.add_household_device(
        household,
        household_card(household, device.device_id, device.name),
    )
    _replicate_matter_device(store, payload, device, household)
    publish_store_fabric(store, gateway)
    return device


def compact_runtime_fabric(devices: list[DeviceResponse]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for device in devices:
        if device.runtime_kind != "matter" or device.node_id is None:
            continue
        clusters = list(device.clusters or [])
        product = match_product(device.type, clusters)
        household = household_kind_for_device(device.type, clusters)
        items.append(
            {
                "id": device.device_id,
                "name": device.name,
                "type": household,
                "n": device.node_id,
                "reads": fabric_reads(product, device.endpoint or 1, clusters),
            }
        )
    return {"kind": "fabric", "devices": items}


def publish_store_fabric(store: Any, gateway_id: str | None = None) -> None:
    from homehub_api.iot.gateway_commands import publish_gateway_fabric

    devices = store.list_all_devices()
    gateways: set[str] = set()
    if gateway_id:
        gateways.add(gateway_id)
    else:
        for device in devices:
            if device.runtime_kind == "matter" and device.gateway_id:
                gateways.add(device.gateway_id)
        gateway = store.find_matter_gateway()
        if gateway is not None:
            gateways.add(gateway.device_id)
    for gateway in gateways:
        children = [
            device
            for device in devices
            if device.runtime_kind == "matter" and (device.gateway_id or gateway) == gateway
        ]
        publish_gateway_fabric(gateway, compact_runtime_fabric(children))
