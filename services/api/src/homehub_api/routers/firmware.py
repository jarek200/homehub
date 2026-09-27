"""Serve private gateway firmware to the CoreS3 OTA client."""

from __future__ import annotations

import os
import re

import boto3
from botocore.config import Config
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

router = APIRouter(prefix="/firmware", tags=["firmware"])

_DEVICE_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


@router.get("/{device_id}", include_in_schema=False)
def gateway_firmware(device_id: str, token: str = Query(min_length=32, max_length=64)):
    """Return the firmware image when the opaque object token matches."""
    if not _DEVICE_ID.fullmatch(device_id):
        raise HTTPException(status_code=404, detail="Firmware not found")
    bucket = os.environ.get("FIRMWARE_BUCKET", "")
    region = os.environ.get("AWS_REGION", "eu-west-1")
    if not bucket:
        raise HTTPException(status_code=404, detail="Firmware not found")

    key = f"gateways/{device_id}/controller.bin"
    s3 = boto3.client(
        "s3",
        region_name=region,
        endpoint_url=f"https://s3.{region}.amazonaws.com",
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
    except s3.exceptions.ClientError as exc:
        raise HTTPException(status_code=404, detail="Firmware not found") from exc

    etag = str(obj.get("ETag", "")).strip('"')
    if not etag or token != etag:
        raise HTTPException(status_code=404, detail="Firmware not found")

    body = obj["Body"].read()
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={"Content-Length": str(len(body)), "ETag": etag},
    )
