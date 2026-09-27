#!/usr/bin/env python3
"""Copy SIMULATOR device rows to DEVICE_REGISTRY. Safe to run more than once."""

from __future__ import annotations

import os
import sys

import boto3
from boto3.dynamodb.conditions import Key


def main() -> None:
    table_name = os.environ.get("TABLE_NAME", "").strip()
    if not table_name:
        raise SystemExit("TABLE_NAME is required")
    table = boto3.resource("dynamodb").Table(table_name)
    copied = 0
    scanned = 0
    start_key = None
    while True:
        kwargs: dict = {
            "KeyConditionExpression": Key("PK").eq("SIMULATOR") & Key("SK").begins_with("DEVICE#"),
        }
        if start_key:
            kwargs["ExclusiveStartKey"] = start_key
        page = table.query(**kwargs)
        for item in page.get("Items", []):
            scanned += 1
            item = dict(item)
            item["PK"] = "DEVICE_REGISTRY"
            table.put_item(Item=item)
            copied += 1
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            break
    print(f"Copied {copied} of {scanned} registry rows to DEVICE_REGISTRY")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(exc, file=sys.stderr)
        raise
