"""Create a per-device IoT certificate and write the classic shadow.

Step Functions cannot call IoT Data Plane (`updateThingShadow`) as an AWS SDK
task, so this Lambda owns the shadow write after the Thing exists.
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

import boto3

from homehub_api.iot.sfn.common import (
    resolve_provision_context,
    shadow_update_payload,
    ssm_prefix_for,
    thing_name_for,
)

AMAZON_ROOT_CA_1_URL = "https://www.amazontrust.com/repository/AmazonRootCA1.pem"


def _amazon_root_ca_pem() -> str:
    cached = os.environ.get("AMAZON_ROOT_CA_PEM", "").strip()
    if cached:
        return cached
    with urllib.request.urlopen(AMAZON_ROOT_CA_1_URL, timeout=10) as response:
        return response.read().decode()


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    context = resolve_provision_context(event)
    device_id = context["deviceId"]
    prefix = context.get("ssmCertPrefix") or ssm_prefix_for(device_id)
    policy_name = os.environ["IOT_POLICY_NAME"]

    iot = boto3.client("iot")
    created = iot.create_keys_and_certificate(setAsActive=True)
    cert_arn = created["certificateArn"]
    cert_id = created["certificateId"]
    cert_pem = created["certificatePem"]
    key_pem = created["keyPair"]["PrivateKey"]

    ssm = boto3.client("ssm")
    ssm.put_parameter(
        Name=f"{prefix}/cert",
        Value=cert_pem,
        Type="SecureString",
        Overwrite=True,
    )
    ssm.put_parameter(
        Name=f"{prefix}/key",
        Value=key_pem,
        Type="SecureString",
        Overwrite=True,
    )
    ssm.put_parameter(
        Name=f"{prefix}/ca",
        Value=_amazon_root_ca_pem(),
        Type="String",
        Overwrite=True,
    )

    device_type = context.get("type")
    gateway_policy = os.environ.get("GATEWAY_IOT_POLICY_NAME", "").strip()
    camera_policy = os.environ.get("CAMERA_IOT_POLICY_NAME", "").strip()
    if device_type == "camera" and camera_policy:
        iot.attach_policy(policyName=camera_policy, target=cert_arn)
    else:
        iot.attach_policy(policyName=policy_name, target=cert_arn)
    if gateway_policy and device_type == "matter-gateway":
        iot.attach_policy(policyName=gateway_policy, target=cert_arn)

    thing_name = context.get("thingName") or thing_name_for(device_id)
    _update_thing_shadow(thing_name, device_type, context.get("configuration"))

    return {
        "certificateArn": cert_arn,
        "certificateId": cert_id,
        "ssmCertPrefix": prefix,
    }


def _update_thing_shadow(thing_name: str, device_type: Any, configuration: Any) -> None:
    endpoint = os.environ.get("IOT_DATA_ENDPOINT", "").strip()
    if not endpoint:
        raise RuntimeError("IOT_DATA_ENDPOINT is required to write the device shadow")
    iot_data = boto3.client("iot-data", endpoint_url=endpoint)
    iot_data.update_thing_shadow(
        thingName=thing_name,
        payload=json.dumps(shadow_update_payload(configuration, device_type or "")).encode(),
    )
