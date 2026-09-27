"""Start a Matter pair from the website. The device row is created only after success."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

from ulid import new as new_ulid

from homehub_api.cores3_fabric import CORES3_GATEWAY_ID
from homehub_api.cores3_products import next_matter_node_id, product_by_id
from homehub_api.errors import ApiError
from homehub_api.household import now_iso
from homehub_api.matter_devices import add_matter_product, devices_for_gateway

COMMISSION_TIMEOUT = timedelta(seconds=180)
_SETUP_CODE = re.compile(r"^\d{11}$")


def _now() -> datetime:
    return datetime.now(UTC)


def normalize_setup_payload(raw: str | None) -> str:
    value = (raw or "").strip()
    if _SETUP_CODE.fullmatch(value):
        return value
    if value.startswith("MT:") and 5 <= len(value) <= 256:
        return value
    raise ApiError("Enter an 11-digit Matter code or QR payload", 400, "ValidationError")


def resolve_gateway_id(gateway_id: str | None) -> str:
    value = (gateway_id or "").strip() or CORES3_GATEWAY_ID
    if len(value) > 64:
        raise ApiError("Invalid gateway", 400, "ValidationError")
    return value


def _job_public(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "commissionId": job["commissionId"],
        "status": job["status"],
        "productId": job["productId"],
        "gatewayId": job["gatewayId"],
        "nodeId": job["nodeId"],
        "name": job.get("name"),
        "location": job.get("location"),
        "deviceId": job.get("deviceId"),
        "error": job.get("error"),
        "createdAt": job["createdAt"],
        "updatedAt": job["updatedAt"],
    }


def start_commission(
    store: Any,
    *,
    product_id: str,
    setup_payload: str,
    gateway_id: str | None,
    name: str | None,
    location: str | None,
) -> dict[str, Any]:
    product = product_by_id(product_id)
    if product is None:
        raise ApiError("Unknown Matter product", 400, "ValidationError")
    payload = normalize_setup_payload(setup_payload)
    gateway = resolve_gateway_id(gateway_id)
    devices = devices_for_gateway(store, gateway)
    reserved = list(store.list_pairing_node_ids(gateway))
    node_id = next_matter_node_id([device.node_id for device in devices] + reserved)
    timestamp = now_iso()
    job = {
        "commissionId": str(new_ulid()),
        "status": "pairing",
        "productId": product_id,
        "gatewayId": gateway,
        "nodeId": node_id,
        "name": (name or "").strip() or None,
        "location": (location or "").strip() or None,
        "deviceId": None,
        "error": None,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    store.put_commission_job(job)
    from homehub_api.iot.gateway_commands import publish_gateway_pair

    publish_gateway_pair(gateway, node_id, payload)
    return _job_public(job)


def complete_commission(
    store: Any,
    commission_id: str,
    event: str,
    error: str | None = None,
) -> dict[str, Any]:
    job = store.get_commission_job(commission_id)
    if job is None:
        raise ApiError("Commission job not found", 404, "NotFound")
    if job["status"] != "pairing":
        return _job_public(job)
    if event == "commissioned":
        device = add_matter_product(
            store,
            product_id=str(job["productId"]),
            name=job.get("name"),
            location=job.get("location"),
            gateway_id=str(job["gatewayId"]),
            node_id=int(job["nodeId"]),
        )
        updated = store.update_commission_job(
            commission_id,
            {
                "status": "succeeded",
                "deviceId": device.device_id,
                "error": None,
            },
        )
        return _job_public(updated)
    updated = store.update_commission_job(
        commission_id,
        {
            "status": "failed",
            "error": (error or "Pairing failed").strip() or "Pairing failed",
        },
    )
    return _job_public(updated)


def get_commission(store: Any, commission_id: str) -> dict[str, Any]:
    job = store.get_commission_job(commission_id)
    if job is None:
        raise ApiError("Commission job not found", 404, "NotFound")
    if job["status"] != "pairing":
        return _job_public(job)
    result = store.get_pair_result(str(job["gatewayId"]), int(job["nodeId"]))
    if result:
        return complete_commission(
            store,
            commission_id,
            str(result.get("event") or ""),
            result.get("error") if isinstance(result.get("error"), str) else None,
        )
    created = datetime.fromisoformat(str(job["createdAt"]).replace("Z", "+00:00"))
    if _now() - created >= COMMISSION_TIMEOUT:
        return complete_commission(store, commission_id, "commission-failed", "Pairing timed out")
    return _job_public(job)
