from typing import Any

import boto3

from homehub_api.household import HOUSEHOLD_METADATA_SK, invite_pk
from homehub_api.store._mapping import _to_device
from homehub_api.store.hub_store import HubStore


def lookup_invite_by_token_hash(table_name: str, token_hash: str) -> dict[str, Any] | None:
    table = boto3.resource("dynamodb").Table(table_name)
    result = table.get_item(Key={"PK": invite_pk(token_hash), "SK": HOUSEHOLD_METADATA_SK})
    item = result.get("Item")
    return dict(item) if item else None


__all__ = ["HubStore", "_to_device", "lookup_invite_by_token_hash"]
