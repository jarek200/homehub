"""Step 2: Create per-device IoT certificate and store in SSM."""

from __future__ import annotations

import os
import urllib.request
from typing import Any

import boto3

from homehub_api.iot.sfn.common import resolve_provision_context, ssm_prefix_for

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

    iot.attach_policy(policyName=policy_name, target=cert_arn)

    return {
        "certificateArn": cert_arn,
        "certificateId": cert_id,
        "ssmCertPrefix": prefix,
    }
