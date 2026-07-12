"""Device provisioning: IoT Thing + Shadow, simulator registry, SQS notify."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import boto3

from homehub_api.config import DEMO_TENANT_PK


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def thing_name_for(device_id: str) -> str:
    return f"homehub-{device_id}"


def _parse_stream_record(record: dict[str, Any]) -> dict[str, Any] | None:
    if record.get("eventName") != "INSERT":
        return None

    dynamodb = record.get("dynamodb", {})
    keys = dynamodb.get("Keys", {})
    sk = keys.get("SK", {}).get("S", "")
    if not sk.startswith("DEVICE#"):
        return None

    new_image = dynamodb.get("NewImage", {})
    lifecycle = new_image.get("lifecycleStatus", {}).get("S")
    if lifecycle != "PROVISIONING":
        return None

    return {
        "tenantPk": new_image.get("PK", {}).get("S", DEMO_TENANT_PK),
        "deviceId": new_image.get("deviceId", {}).get("S", sk.removeprefix("DEVICE#")),
        "name": new_image.get("name", {}).get("S", ""),
        "type": new_image.get("type", {}).get("S", ""),
        "configuration": new_image.get("configuration", {}).get("S"),
    }


def _shadow_desired(configuration: str | None, device_type: str) -> dict[str, Any]:
    desired: dict[str, Any] = {"type": device_type}
    if configuration:
        try:
            desired["configuration"] = json.loads(configuration)
        except json.JSONDecodeError:
            desired["configuration"] = configuration
    return desired


def _mark_failed(
    table: Any,
    tenant_pk: str,
    device_id: str,
    reason: str,
) -> None:
    table.update_item(
        Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"},
        UpdateExpression=(
            "SET lifecycleStatus = :failed, failureReason = :reason, updatedAt = :updatedAt"
        ),
        ExpressionAttributeValues={
            ":failed": "FAILED",
            ":reason": reason[:500],
            ":updatedAt": _now_iso(),
        },
    )


def provision_device(
    *,
    table_name: str,
    queue_url: str,
    device: dict[str, Any],
    skip_iot: bool = False,
) -> None:
    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(table_name)
    tenant_pk = device["tenantPk"]
    device_id = device["deviceId"]
    thing = thing_name_for(device_id)
    timestamp = _now_iso()

    try:
        if not skip_iot:
            iot = boto3.client("iot")
            try:
                iot.create_thing(thingName=thing, attributePayload={"attributes": {"deviceId": device_id}})
            except iot.exceptions.ResourceAlreadyExistsException:
                pass

            policy_name = os.environ.get("IOT_POLICY_NAME", "").strip()
            if policy_name:
                # Shared simulator cert policy is attached to the certificate principal manually.
                pass

            desired = _shadow_desired(device.get("configuration"), device.get("type", ""))
            iot_data = boto3.client(
                "iot-data",
                endpoint_url=os.environ.get("IOT_DATA_ENDPOINT") or None,
            )
            iot_data.update_thing_shadow(
                thingName=thing,
                payload=json.dumps({"state": {"desired": desired}}).encode(),
            )

        table.put_item(
            Item={
                "PK": "SIMULATOR",
                "SK": f"DEVICE#{device_id}",
                "deviceId": device_id,
                "thingName": thing,
                "enabled": True,
                "status": "READY",
                "tenantPk": tenant_pk,
                "updatedAt": timestamp,
            }
        )

        table.update_item(
            Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"},
            UpdateExpression=(
                "SET lifecycleStatus = :ready, thingName = :thing, updatedAt = :updatedAt "
                "REMOVE failureReason"
            ),
            ExpressionAttributeValues={
                ":ready": "READY",
                ":thing": thing,
                ":updatedAt": timestamp,
            },
        )

        if queue_url:
            boto3.client("sqs").send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps({"eventType": "DEVICE_READY", "deviceId": device_id}),
            )
    except Exception as exc:
        _mark_failed(table, tenant_pk, device_id, str(exc))
        raise


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    table_name = os.environ["TABLE_NAME"]
    queue_url = os.environ.get("SIMULATOR_QUEUE_URL", "")
    skip_iot = os.environ.get("SKIP_IOT_PROVISIONING", "").lower() in {"1", "true", "yes"}

    failures: list[str] = []
    for record in event.get("Records", []):
        device = _parse_stream_record(record)
        if not device:
            continue
        try:
            provision_device(
                table_name=table_name,
                queue_url=queue_url,
                device=device,
                skip_iot=skip_iot,
            )
        except Exception as exc:
            failures.append(f"{device['deviceId']}: {exc}")

    if failures:
        raise RuntimeError("; ".join(failures))

    return {"processed": len(event.get("Records", []))}
