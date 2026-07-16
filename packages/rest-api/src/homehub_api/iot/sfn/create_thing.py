"""Step 3: Create IoT Thing, attach certificate, initialize Shadow."""

from __future__ import annotations

import json
import os
from typing import Any

import boto3

from homehub_api.iot.sfn.common import resolve_provision_context, shadow_desired, thing_name_for


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    context = resolve_provision_context(event)
    device_id = context["deviceId"]
    thing = context.get("thingName") or thing_name_for(device_id)
    cert_arn = context["certificateArn"]

    iot = boto3.client("iot")
    try:
        iot.create_thing(
            thingName=thing,
            attributePayload={"attributes": {"deviceId": device_id}},
        )
    except iot.exceptions.ResourceAlreadyExistsException:
        pass

    try:
        iot.attach_thing_principal(thingName=thing, principal=cert_arn)
    except iot.exceptions.ResourceAlreadyExistsException:
        pass

    desired = shadow_desired(context.get("configuration"), context.get("type", ""))
    endpoint = os.environ.get("IOT_DATA_ENDPOINT", "").strip()
    iot_data = boto3.client("iot-data", endpoint_url=endpoint or None)
    iot_data.update_thing_shadow(
        thingName=thing,
        payload=json.dumps({"state": {"desired": desired}}).encode(),
    )

    return {"thingName": thing}
