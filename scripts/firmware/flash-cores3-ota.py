#!/usr/bin/env python3
"""Upload a CoreS3 app image and publish a short-lived HTTPS OTA command."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/api/src"))

from homehub_api.iot.gateway_commands import firmware_ota_payload


def _bucket_name(stage: str) -> str:
    return os.environ.get("FIRMWARE_BUCKET") or f"homehub-firmware-{stage}"


def _rest_api_url(stage: str, region: str) -> str:
    configured = os.environ.get("REST_API_URL", "").rstrip("/")
    if configured:
        return configured
    apis = boto3.client("apigatewayv2", region_name=region).get_apis().get("Items", [])
    expected = f"homehub-{stage}-DeviceRestApi"
    for api in apis:
        if expected in str(api.get("Name", "")):
            return str(api["ApiEndpoint"]).rstrip("/")
    raise SystemExit(f"Could not resolve the HomeHub {stage} REST API")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", required=True, type=Path)
    parser.add_argument("--device-id", default="cores3-gateway")
    parser.add_argument("--stage", default=os.environ.get("SST_STAGE", "int"))
    parser.add_argument("--expires", type=int, default=900)
    args = parser.parse_args()

    if not args.bin.is_file():
        raise SystemExit(f"Firmware image not found: {args.bin}")

    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "eu-west-1"
    bucket = _bucket_name(args.stage)
    key = f"gateways/{args.device_id}/controller.bin"
    s3 = boto3.client(
        "s3",
        region_name=region,
        endpoint_url=f"https://s3.{region}.amazonaws.com",
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )
    try:
        s3.head_bucket(Bucket=bucket)
    except ClientError as exc:
        raise SystemExit(
            f"Firmware bucket {bucket} is missing. Deploy int first (pnpm deploy:int)."
        ) from exc

    s3.upload_file(
        str(args.bin),
        bucket,
        key,
        ExtraArgs={"ContentType": "application/octet-stream"},
    )
    etag = str(s3.head_object(Bucket=bucket, Key=key)["ETag"]).strip('"')
    url = f"{_rest_api_url(args.stage, region)}/firmware/{args.device_id}?token={etag}"
    payload = firmware_ota_payload(args.device_id, url)

    endpoint = os.environ.get("IOT_DATA_ENDPOINT", "").strip()
    if not endpoint:
        iot = boto3.client("iot", region_name=region)
        endpoint = iot.describe_endpoint(endpointType="iot:Data-ATS")["endpointAddress"]
    host = endpoint.replace("https://", "")
    iot_data = boto3.client("iot-data", region_name=region, endpoint_url=f"https://{host}")
    payload_json = json.dumps(payload)
    print(f"uploaded s3://{bucket}/{key}")
    for suffix in ("ota", "commands"):
        topic = f"homehub/gateways/{args.device_id}/{suffix}"
        iot_data.publish(topic=topic, qos=1, payload=payload_json)
        print(f"published OTA command on {topic}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
