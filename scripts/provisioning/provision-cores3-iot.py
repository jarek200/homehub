#!/usr/bin/env python3
"""Create or reuse the CoreS3 AWS IoT Thing/cert and write generated/iot_config.h."""

from __future__ import annotations

import argparse
import os
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

AMAZON_ROOT_CA_1_URL = "https://www.amazontrust.com/repository/AmazonRootCA1.pem"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _table(name: str):
    return boto3.resource("dynamodb").Table(name)


def _tenant_pks(hub_id: str) -> list[str]:
    household_id = hub_id.removeprefix("HOUSEHOLD#")
    return [f"HOUSEHOLD#{household_id}"]


def _ssm_get(ssm, name: str, decrypt: bool = True) -> str | None:
    try:
        return ssm.get_parameter(Name=name, WithDecryption=decrypt)["Parameter"]["Value"]
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ParameterNotFound":
            return None
        raise


def _write_header(
    path: Path,
    endpoint: str,
    device_id: str,
    hub_id: str,
    thing_name: str,
    ca_pem: str,
    cert_pem: str,
    key_pem: str,
) -> None:
    content = f"""#ifndef HOMEHUB_IOT_CONFIG_H
#define HOMEHUB_IOT_CONFIG_H

#define HOMEHUB_IOT_ENABLED 1
#define HOMEHUB_IOT_ENDPOINT "{endpoint}"
#define HOMEHUB_DEVICE_ID "{device_id}"
#define HOMEHUB_HUB_ID "{hub_id}"
#define HOMEHUB_THING_NAME "{thing_name}"

static const char HOMEHUB_AWS_ROOT_CA[] = R"HOMEHUB_EOF(
{ca_pem.strip()}
)HOMEHUB_EOF";

static const char HOMEHUB_DEVICE_CERT[] = R"HOMEHUB_EOF(
{cert_pem.strip()}
)HOMEHUB_EOF";

static const char HOMEHUB_DEVICE_KEY[] = R"HOMEHUB_EOF(
{key_pem.strip()}
)HOMEHUB_EOF";

#endif
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    path.chmod(0o600)


def provision(args: argparse.Namespace) -> None:
    table_name = os.environ.get("TABLE_NAME", "").strip()
    if not table_name:
        raise SystemExit("TABLE_NAME is required")

    device_id = args.device_id
    thing_name = f"homehub-{device_id}"
    prefix = f"/homehub/devices/{device_id}"
    stage = args.stage
    policy_name = os.environ.get("IOT_POLICY_NAME", f"homehub-{stage}-device")
    gateway_policy = os.environ.get("GATEWAY_IOT_POLICY_NAME", f"homehub-{stage}-gateway")
    hub_id = args.hub_id

    iot = boto3.client("iot")
    ssm = boto3.client("ssm")
    table = _table(table_name)

    endpoint = iot.describe_endpoint(endpointType="iot:Data-ATS")["endpointAddress"]
    cert_pem = _ssm_get(ssm, f"{prefix}/cert")
    key_pem = _ssm_get(ssm, f"{prefix}/key")
    ca_pem = _ssm_get(ssm, f"{prefix}/ca", decrypt=False)
    certificate_id = None
    certificate_arn = None

    try:
        iot.create_thing(
            thingName=thing_name,
            attributePayload={"attributes": {"deviceId": device_id}},
        )
        print(f"created Thing {thing_name}")
    except iot.exceptions.ResourceAlreadyExistsException:
        iot.update_thing(
            thingName=thing_name,
            attributePayload={"attributes": {"deviceId": device_id}, "merge": True},
        )
        print(f"reused Thing {thing_name}")

    principals = iot.list_thing_principals(thingName=thing_name).get("principals", [])
    if cert_pem and key_pem and principals:
        certificate_arn = principals[0]
        certificate_id = certificate_arn.split("/")[-1]
        print(f"reused certificate {certificate_id}")
    else:
        created = iot.create_keys_and_certificate(setAsActive=True)
        certificate_arn = created["certificateArn"]
        certificate_id = created["certificateId"]
        cert_pem = created["certificatePem"]
        key_pem = created["keyPair"]["PrivateKey"]
        ssm.put_parameter(Name=f"{prefix}/cert", Value=cert_pem, Type="SecureString", Overwrite=True)
        ssm.put_parameter(Name=f"{prefix}/key", Value=key_pem, Type="SecureString", Overwrite=True)
        iot.attach_thing_principal(thingName=thing_name, principal=certificate_arn)
        print(f"created certificate {certificate_id}")

    if not ca_pem:
        with urllib.request.urlopen(AMAZON_ROOT_CA_1_URL, timeout=10) as response:
            ca_pem = response.read().decode()
        ssm.put_parameter(Name=f"{prefix}/ca", Value=ca_pem, Type="String", Overwrite=True)

    if not certificate_arn:
        raise SystemExit("No certificate ARN for the CoreS3 Thing")

    iot.attach_policy(policyName=policy_name, target=certificate_arn)
    iot.attach_policy(policyName=gateway_policy, target=certificate_arn)

    timestamp = _now_iso()
    table.put_item(
        Item={
            "PK": "DEVICE_REGISTRY",
            "SK": f"DEVICE#{device_id}",
            "deviceId": device_id,
            "thingName": thing_name,
            "enabled": False,
            "runtimeKind": "physical",
            "status": "READY",
            "tenantPk": f"HOUSEHOLD#{hub_id.removeprefix('HOUSEHOLD#')}",
            "hubId": hub_id,
            "ssmCertPrefix": prefix,
            "certificateId": certificate_id,
            "updatedAt": timestamp,
        }
    )

    household_id = hub_id.removeprefix("HOUSEHOLD#")
    existing_lookup = table.get_item(Key={"PK": f"GATEWAY#{device_id}", "SK": "HOUSEHOLD"}).get(
        "Item"
    )
    current_owner = str((existing_lookup or {}).get("householdId") or "")
    if not existing_lookup or current_owner in {"", "demo"} or current_owner == household_id:
        table.put_item(
            Item={
                "PK": f"GATEWAY#{device_id}",
                "SK": "HOUSEHOLD",
                "householdId": household_id,
                "tenantPk": f"HOUSEHOLD#{household_id}",
                "updatedAt": timestamp,
            }
        )
    else:
        print(f"kept GATEWAY#{device_id} household {current_owner}")

    for tenant_pk in _tenant_pks(hub_id):
        existing = table.get_item(Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"}).get("Item")
        if not existing:
            continue
        table.update_item(
            Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"},
            UpdateExpression=(
                "SET thingName = :thing, certificateId = :certId, lifecycleStatus = :ready, "
                "updatedAt = :updatedAt REMOVE failureReason"
            ),
            ExpressionAttributeValues={
                ":thing": thing_name,
                ":certId": certificate_id,
                ":ready": "READY",
                ":updatedAt": timestamp,
            },
        )
        print(f"updated {tenant_pk} DEVICE#{device_id}")

    header = Path(args.header)
    _write_header(header, endpoint, device_id, hub_id, thing_name, ca_pem, cert_pem, key_pem)
    print(f"wrote {header}")
    print(f"thing={thing_name} endpoint={endpoint}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device-id", default="cores3-gateway")
    parser.add_argument("--hub-id", default="demo")
    parser.add_argument("--stage", default=os.environ.get("SST_STAGE", "int"))
    parser.add_argument("--header", required=True)
    provision(parser.parse_args())


if __name__ == "__main__":
    main()
