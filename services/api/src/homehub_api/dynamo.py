"""Small DynamoDB expression helpers for the resource Table API."""

from __future__ import annotations

from typing import Any

from boto3.dynamodb.conditions import ConditionBase, Key


def sk_begins_with(pk: str, prefix: str) -> ConditionBase:
    return Key("PK").eq(pk) & Key("SK").begins_with(prefix)


def sk_between(pk: str, start_sk: str, end_sk: str) -> ConditionBase:
    return Key("PK").eq(pk) & Key("SK").between(start_sk, end_sk)


def set_update(fields: dict[str, Any]) -> dict[str, Any]:
    names = {f"#{name}": name for name in fields}
    values = {f":{name}": value for name, value in fields.items()}
    return {
        "UpdateExpression": "SET " + ", ".join(f"#{name} = :{name}" for name in fields),
        "ExpressionAttributeNames": names,
        "ExpressionAttributeValues": values,
    }
