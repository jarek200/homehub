"""IoT Rule target: persist CoreS3 gateway household state and child readings."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any, cast

import boto3

from homehub_api.config import DEMO_TENANT_PK
from homehub_api.dynamo import sk_begins_with
from homehub_api.household import resolve_household_pk_for_gateway
from homehub_api.hub_state import (
    drop_mismatched_household_cards,
    merge_household_state,
    normalize_household_state,
)
from homehub_api.iot.telemetry import write_telemetry
from homehub_api.observability import logger
from homehub_api.revisions import commit_hub_state
from homehub_api.sensor_events import persist_durable_events
from homehub_api.sensor_history import SENSOR_HISTORY_KEY, apply_sensor_history
from homehub_api.store import HubStore

_table = None


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _table_resource():
    global _table
    if _table is None:
        name = os.environ["TABLE_NAME"]
        _table = boto3.resource("dynamodb").Table(name)
    return _table


def tenant_pks_for_gateway(
    table: Any, gateway_id: str | None = None, hub_id: str | None = None
) -> list[str]:
    return [resolve_household_pk_for_gateway(table, gateway_id, hub_id)]


def apply_gateway_readings(
    readings: list[Any],
    *,
    recorded_at: str,
    tenant_pks: list[str],
    table: Any | None = None,
) -> int:
    written = 0
    dynamo = table or _table_resource()
    for reading in readings:
        if not isinstance(reading, dict):
            continue
        device_id = str(reading.get("deviceId") or "")
        metrics = reading.get("metrics")
        if not device_id or not isinstance(metrics, dict) or not metrics:
            continue
        for tenant_pk in tenant_pks:
            if not dynamo.get_item(Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"}).get("Item"):
                continue
            write_telemetry(
                {
                    "tenantPk": tenant_pk,
                    "deviceId": device_id,
                    "recordedAt": recorded_at,
                    "metrics": metrics,
                }
            )
            written += 1
    return written


def apply_commission_event(event: dict[str, Any]) -> dict[str, str]:
    gateway_id = str(event.get("gatewayId") or "")
    raw_node = event.get("node")
    try:
        node_id = int(cast(Any, raw_node))
    except (TypeError, ValueError):
        logger.warning("Commission event missing node", extra={"gateway_id": gateway_id})
        return {"status": "ignored"}
    result_event = str(event.get("event") or "")
    error = event.get("error") if isinstance(event.get("error"), str) else None
    table = _table_resource()
    table_name = os.environ["TABLE_NAME"]

    pointer = table.get_item(Key={"PK": f"GATEWAY#{gateway_id}", "SK": f"PAIR#{node_id}"}).get(
        "Item"
    )
    if not pointer:
        logger.info(
            "Commission event without job",
            extra={"gateway_id": gateway_id, "node_id": node_id},
        )
        return {"status": "ignored"}
    store = HubStore(table_name, tenant_pk=str(pointer.get("tenantPk") or DEMO_TENANT_PK))
    store.put_pair_result(gateway_id, node_id, result_event, error)
    from homehub_api.matter_commission import complete_commission

    complete_commission(
        store,
        str(pointer.get("commissionId") or ""),
        result_event,
        error,
    )
    logger.info(
        "Applied commission event",
        extra={"gateway_id": gateway_id, "node_id": node_id, "event": result_event},
    )
    return {"status": "ok"}


def device_types_for_tenant(table: Any, tenant_pk: str) -> dict[str, str]:
    try:
        response = table.query(KeyConditionExpression=sk_begins_with(tenant_pk, "DEVICE#"))
    except (AttributeError, TypeError):
        return {}
    types: dict[str, str] = {}
    for item in response.get("Items") or []:
        if not isinstance(item, dict) or not item.get("type"):
            continue
        device_id = str(item.get("deviceId") or str(item.get("SK") or "").removeprefix("DEVICE#"))
        if device_id:
            types[device_id] = str(item["type"])
    return types


def handler(event: dict[str, Any], _context: Any) -> dict[str, str]:
    gateway_id = str(event.get("gatewayId") or "")
    result_event = str(event.get("event") or "")
    if result_event in {"commissioned", "commission-failed"}:
        return apply_commission_event(event)
    if result_event:
        return {"status": "ignored"}
    state = event.get("state")
    if not isinstance(state, dict):
        logger.warning("Gateway state missing state object", extra={"gateway_id": gateway_id})
        return {"status": "ignored"}
    commission = state.get("commission")
    if isinstance(commission, dict) and commission.get("event"):
        apply_commission_event(
            {
                "gatewayId": gateway_id,
                "event": commission.get("event"),
                "node": commission.get("node"),
                "error": commission.get("error"),
            }
        )
        state = {key: value for key, value in state.items() if key != "commission"}

    table = _table_resource()
    event_hub = str(event.get("hubId") or event.get("tenantPk") or "")
    tenant_pk = resolve_household_pk_for_gateway(table, gateway_id or None, event_hub or None)
    timestamp = str(event.get("recordedAt") or _now_iso())
    incoming = {**state, "updatedAt": state.get("updatedAt") or timestamp}
    incoming.pop(SENSOR_HISTORY_KEY, None)
    types = device_types_for_tenant(table, tenant_pk)
    previous_holder: dict[str, Any] = {"state": None}

    def mutate(previous: dict[str, Any]) -> dict[str, Any]:
        previous_holder["state"] = previous
        merged = normalize_household_state(merge_household_state(previous, incoming))
        merged = drop_mismatched_household_cards(merged, types)
        return apply_sensor_history(previous, merged, timestamp)

    merged = commit_hub_state(
        table,
        tenant_pk,
        mutate,
        extra_item_fields={"gatewayId": gateway_id or None},
    )
    persist_durable_events(table, tenant_pk, previous_holder["state"], merged, timestamp)
    readings = event.get("readings")
    written = 0
    if isinstance(readings, list):
        written = apply_gateway_readings(
            readings, recorded_at=timestamp, tenant_pks=[tenant_pk], table=table
        )
    logger.info(
        "Stored gateway state",
        extra={"gateway_id": gateway_id, "tenant_pk": tenant_pk, "readings": written},
    )
    return {"status": "ok"}
