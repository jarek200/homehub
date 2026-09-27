#!/usr/bin/env python3
"""Upsert CoreS3 fabric devices into real households only — never the demo household."""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import boto3
from boto3.dynamodb.conditions import Attr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api" / "src"))

from homehub_api.cores3_fabric import (  # noqa: E402
    CORES3_FABRIC_DEVICES,
    CORES3_GATEWAY_ID,
    cores3_household_state,
)
from homehub_api.household import (  # noqa: E402
    HOUSEHOLD_LOOKUP_SK,
    gateway_pk,
    household_pk,
)
from homehub_api.device_configuration import configuration_for_create  # noqa: E402
from homehub_api.hub_state import HUB_STATE_SK, dynamo_safe, merge_household_state  # noqa: E402


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _table():
    name = os.environ.get("TABLE_NAME", "").strip()
    if not name:
        raise SystemExit("TABLE_NAME is required")
    return boto3.resource("dynamodb").Table(name)


def _tenant_pks(table) -> list[str]:
    pks: set[str] = set()
    scan_kwargs: dict = {
        "FilterExpression": Attr("SK").eq("PROFILE"),
        "ProjectionExpression": "PK, householdId",
    }
    while True:
        page = table.scan(**scan_kwargs)
        for item in page.get("Items", []):
            household_id = str(item.get("householdId") or "")
            if household_id and household_id != "demo":
                pks.add(household_pk(household_id))
        last = page.get("LastEvaluatedKey")
        if not last:
            break
        scan_kwargs["ExclusiveStartKey"] = last
    return sorted(pks)


def _device_item(tenant_pk: str, spec: dict, timestamp: str) -> dict:
    runtime_kind = spec["runtimeKind"]
    configuration = configuration_for_create(spec["type"], None, runtime_kind=runtime_kind)
    item = {
        "PK": tenant_pk,
        "SK": f"DEVICE#{spec['deviceId']}",
        "deviceId": spec["deviceId"],
        "name": spec["name"],
        "type": spec["type"],
        "location": spec["location"],
        "runtimeKind": runtime_kind,
        "status": "ONLINE",
        "lifecycleStatus": "READY",
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    if configuration:
        item["configuration"] = configuration
    if runtime_kind == "matter":
        item["gatewayId"] = CORES3_GATEWAY_ID
    if spec.get("nodeId") is not None:
        item["nodeId"] = spec["nodeId"]
    if spec.get("endpoint") is not None:
        item["endpoint"] = spec["endpoint"]
    if spec.get("clusters"):
        item["clusters"] = list(spec["clusters"])
    return dynamo_safe(item)


def seed_tenant(table, tenant_pk: str) -> None:
    timestamp = _now_iso()
    for spec in CORES3_FABRIC_DEVICES:
        existing = table.get_item(Key={"PK": tenant_pk, "SK": f"DEVICE#{spec['deviceId']}"})
        item = _device_item(tenant_pk, spec, timestamp)
        if existing.get("Item"):
            item["createdAt"] = existing["Item"].get("createdAt") or timestamp
            for key in (
                "thingName",
                "certificateId",
                "lastReading",
                "recentReadings",
                "lastSeenAt",
            ):
                if existing["Item"].get(key):
                    item[key] = existing["Item"][key]
        table.put_item(Item=item)
    seeded = cores3_household_state(timestamp)
    existing_state = table.get_item(Key={"PK": tenant_pk, "SK": HUB_STATE_SK}).get("Item", {})
    previous = existing_state.get("state") if isinstance(existing_state.get("state"), dict) else {}
    state = merge_household_state(previous, seeded) if previous else seeded
    table.put_item(
        Item={
            "PK": tenant_pk,
            "SK": HUB_STATE_SK,
            "state": dynamo_safe({**state, "stateVersion": 1}),
            "revision": 1,
            "updatedAt": timestamp,
        }
    )
    household_id = tenant_pk.removeprefix("HOUSEHOLD#")
    existing_lookup = table.get_item(
        Key={"PK": gateway_pk(CORES3_GATEWAY_ID), "SK": HOUSEHOLD_LOOKUP_SK}
    ).get("Item")
    current_owner = str((existing_lookup or {}).get("householdId") or "")
    if not existing_lookup or current_owner in {"", "demo"} or current_owner == household_id:
        table.put_item(
            Item={
                "PK": gateway_pk(CORES3_GATEWAY_ID),
                "SK": HOUSEHOLD_LOOKUP_SK,
                "householdId": household_id,
                "tenantPk": household_pk(household_id),
                "updatedAt": timestamp,
            }
        )


def main() -> None:
    table = _table()
    tenants = _tenant_pks(table)
    for tenant_pk in tenants:
        seed_tenant(table, tenant_pk)
        print(f"seeded {tenant_pk}")
    print(f"done tenants={len(tenants)} devices={len(CORES3_FABRIC_DEVICES)}")


if __name__ == "__main__":
    main()
