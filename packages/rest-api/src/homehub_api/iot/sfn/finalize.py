"""Step 4: Write simulator registry, mark READY, notify the device runtime via SQS."""

from __future__ import annotations

import json
import os
from typing import Any

import boto3

from homehub_api.config import hub_id_from_pk
from homehub_api.iot.sfn.common import _now_iso, resolve_provision_context, ssm_prefix_for, thing_name_for


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    table_name = os.environ["TABLE_NAME"]
    queue_url = os.environ.get("SIMULATOR_QUEUE_URL", "")
    table = boto3.resource("dynamodb").Table(table_name)

    context = resolve_provision_context(event)
    device_id = context["deviceId"]
    tenant_pk = context["tenantPk"]
    thing = context.get("thingName") or thing_name_for(device_id)
    prefix = context.get("ssmCertPrefix") or ssm_prefix_for(device_id)
    timestamp = _now_iso()

    registry_item: dict[str, Any] = {
        "PK": "SIMULATOR",
        "SK": f"DEVICE#{device_id}",
        "deviceId": device_id,
        "thingName": thing,
        "enabled": True,
        "status": "READY",
        "tenantPk": tenant_pk,
        "hubId": hub_id_from_pk(tenant_pk),
        "ssmCertPrefix": prefix,
        "updatedAt": timestamp,
    }
    if context.get("certificateId"):
        registry_item["certificateId"] = context["certificateId"]

    table.put_item(Item=registry_item)

    update_values: dict[str, Any] = {
        ":ready": "READY",
        ":thing": thing,
        ":updatedAt": timestamp,
    }
    update_expression = (
        "SET lifecycleStatus = :ready, thingName = :thing, updatedAt = :updatedAt REMOVE failureReason"
    )
    if context.get("certificateId"):
        update_expression = (
            "SET lifecycleStatus = :ready, thingName = :thing, certificateId = :certId, "
            "updatedAt = :updatedAt REMOVE failureReason"
        )
        update_values[":certId"] = context["certificateId"]

    table.update_item(
        Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"},
        UpdateExpression=update_expression,
        ExpressionAttributeValues=update_values,
    )

    if queue_url:
        boto3.client("sqs").send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({"eventType": "DEVICE_READY", "deviceId": device_id}),
        )

    return {"deviceId": device_id, "lifecycleStatus": "READY", "thingName": thing}
