"""Revoke per-device IoT cert and delete SSM parameters on device delete."""

from __future__ import annotations

import os
from typing import Any

import boto3

from homehub_api.iot.sfn.common import ssm_prefix_for


def _delete_ssm_prefix(prefix: str) -> None:
    ssm = boto3.client("ssm")
    for suffix in ("cert", "key", "ca"):
        name = f"{prefix}/{suffix}"
        try:
            ssm.delete_parameter(Name=name)
        except ssm.exceptions.ParameterNotFound:
            pass


def decommission_device_resources(
    *,
    device_id: str,
    certificate_id: str | None,
    thing_name: str | None,
) -> None:
    iot = boto3.client("iot")
    prefix = ssm_prefix_for(device_id)

    if certificate_id:
        try:
            description = iot.describe_certificate(certificateId=certificate_id)["certificateDescription"]
            cert_arn = description["certificateArn"]
            if thing_name:
                try:
                    iot.detach_thing_principal(thingName=thing_name, principal=cert_arn)
                except Exception:
                    pass
            policy_name = os.environ.get("IOT_POLICY_NAME", "").strip()
            if policy_name:
                try:
                    iot.detach_policy(policyName=policy_name, target=cert_arn)
                except Exception:
                    pass
            iot.update_certificate(certificateId=certificate_id, newStatus="INACTIVE")
            iot.delete_certificate(certificateId=certificate_id, forceDelete=True)
        except Exception:
            pass

    if thing_name:
        try:
            iot.delete_thing(thingName=thing_name)
        except Exception:
            pass

    _delete_ssm_prefix(prefix)


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    decommission_device_resources(
        device_id=event["deviceId"],
        certificate_id=event.get("certificateId"),
        thing_name=event.get("thingName"),
    )
    return {"decommissioned": True, "deviceId": event["deviceId"]}
