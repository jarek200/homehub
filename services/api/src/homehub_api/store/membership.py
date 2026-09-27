from __future__ import annotations

from datetime import datetime
from typing import Any

from boto3.dynamodb.conditions import Attr

from homehub_api.household import (
    HOUSEHOLD_METADATA_SK,
    PROFILE_SK,
    invite_pk,
    invite_sk,
    member_sk,
    user_pk,
)
from homehub_api.store._mapping import _low_level_item, _now_iso
from homehub_api.store._surface import StoreSurface


class MembershipMixin(StoreSurface):
    def get_profile(self, user_id: str) -> dict[str, Any] | None:
        result = self._table.get_item(Key={"PK": user_pk(user_id), "SK": PROFILE_SK})
        item = result.get("Item")
        return dict(item) if item else None

    def put_profile(self, user_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        existing = self.get_profile(user_id) or {
            "PK": user_pk(user_id),
            "SK": PROFILE_SK,
            "userId": user_id,
            "createdAt": _now_iso(),
        }
        item = {**existing, **updates, "userId": user_id, "updatedAt": _now_iso()}
        item["PK"] = user_pk(user_id)
        item["SK"] = PROFILE_SK
        self._table.put_item(Item=item)
        return item

    def get_household_metadata(self) -> dict[str, Any] | None:
        result = self._table.get_item(Key={"PK": self.tenant_pk, "SK": HOUSEHOLD_METADATA_SK})
        item = result.get("Item")
        return dict(item) if item else None

    def put_household_metadata(self, record: dict[str, Any]) -> dict[str, Any]:
        timestamp = _now_iso()
        item = {
            "PK": self.tenant_pk,
            "SK": HOUSEHOLD_METADATA_SK,
            "householdId": self.household_id,
            "createdAt": record.get("createdAt") or timestamp,
            **record,
            "updatedAt": timestamp,
        }
        self._table.put_item(Item=item)
        return item

    def get_member(self, user_id: str) -> dict[str, Any] | None:
        result = self._table.get_item(Key={"PK": self.tenant_pk, "SK": member_sk(user_id)})
        item = result.get("Item")
        return dict(item) if item else None

    def put_member(self, record: dict[str, Any]) -> dict[str, Any]:
        user_id = str(record["userId"])
        timestamp = _now_iso()
        item = {
            "PK": self.tenant_pk,
            "SK": member_sk(user_id),
            "householdId": self.household_id,
            "createdAt": record.get("createdAt") or timestamp,
            **record,
            "updatedAt": timestamp,
        }
        self._table.put_item(Item=item)
        return item

    def delete_member(self, user_id: str) -> None:
        self._table.delete_item(Key={"PK": self.tenant_pk, "SK": member_sk(user_id)})

    def list_members(self) -> list[dict[str, Any]]:
        result = self._query_sk_prefix(self.tenant_pk, "MEMBER#")
        return [dict(item) for item in result.get("Items") or []]

    def list_invites(self) -> list[dict[str, Any]]:
        result = self._query_sk_prefix(self.tenant_pk, "INVITE#")
        return [dict(item) for item in result.get("Items") or []]

    def get_invite(self, invite_id: str) -> dict[str, Any] | None:
        result = self._table.get_item(Key={"PK": self.tenant_pk, "SK": invite_sk(invite_id)})
        item = result.get("Item")
        return dict(item) if item else None

    def put_invite(self, record: dict[str, Any], token_hash: str | None = None) -> dict[str, Any]:
        invite_id = str(record["inviteId"])
        timestamp = _now_iso()
        item = {
            "PK": self.tenant_pk,
            "SK": invite_sk(invite_id),
            "householdId": self.household_id,
            "createdAt": record.get("createdAt") or timestamp,
            **record,
            "updatedAt": timestamp,
        }
        self._table.put_item(Item=item)
        if token_hash:
            self._table.put_item(
                Item={
                    "PK": invite_pk(token_hash),
                    "SK": HOUSEHOLD_METADATA_SK,
                    "inviteId": invite_id,
                    "householdId": self.household_id,
                    "tenantPk": self.tenant_pk,
                    "emailHash": record.get("emailHash"),
                    "status": record.get("status", "pending"),
                    "role": record.get("role", "MEMBER"),
                    "expiresAt": record.get("expiresAt"),
                    "updatedAt": timestamp,
                }
            )
        return item

    def delete_invite_token(self, token_hash: str) -> None:
        self._table.delete_item(Key={"PK": invite_pk(token_hash), "SK": HOUSEHOLD_METADATA_SK})

    def get_invite_by_token_hash(self, token_hash: str) -> dict[str, Any] | None:
        result = self._table.get_item(
            Key={"PK": invite_pk(token_hash), "SK": HOUSEHOLD_METADATA_SK}
        )
        item = result.get("Item")
        return dict(item) if item else None

    def accept_invite_transaction(
        self,
        *,
        user_id: str,
        email: str,
        username: str,
        invite: dict[str, Any],
        token_hash: str,
        profile: dict[str, Any] | None,
    ) -> dict[str, Any]:
        timestamp = _now_iso()
        household_id = str(invite["householdId"])
        role = str(invite.get("role") or "MEMBER")
        invite_id = str(invite["inviteId"])
        client = self._table.meta.client
        profile_item = {
            **(profile or {}),
            "PK": user_pk(user_id),
            "SK": PROFILE_SK,
            "userId": user_id,
            "email": email,
            "username": username,
            "householdId": household_id,
            "role": role,
            "createdAt": (profile or {}).get("createdAt") or timestamp,
            "updatedAt": timestamp,
        }
        member_item = {
            "PK": self.tenant_pk,
            "SK": member_sk(user_id),
            "userId": user_id,
            "email": email,
            "role": role,
            "householdId": household_id,
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
        invite_item = {
            **invite,
            "PK": self.tenant_pk,
            "SK": invite_sk(invite_id),
            "status": "accepted",
            "acceptedBy": user_id,
            "updatedAt": timestamp,
        }
        token_item = {
            "PK": invite_pk(token_hash),
            "SK": HOUSEHOLD_METADATA_SK,
            "inviteId": invite_id,
            "householdId": household_id,
            "tenantPk": self.tenant_pk,
            "emailHash": invite.get("emailHash"),
            "status": "accepted",
            "role": role,
            "expiresAt": invite.get("expiresAt"),
            "updatedAt": timestamp,
        }
        client.transact_write_items(
            TransactItems=[
                {
                    "Put": {
                        "TableName": self.table_name,
                        "Item": _low_level_item(token_item),
                        "ConditionExpression": "attribute_exists(PK) AND #status = :pending",
                        "ExpressionAttributeNames": {"#status": "status"},
                        "ExpressionAttributeValues": {":pending": {"S": "pending"}},
                    }
                },
                {"Put": {"TableName": self.table_name, "Item": _low_level_item(member_item)}},
                {"Put": {"TableName": self.table_name, "Item": _low_level_item(profile_item)}},
                {"Put": {"TableName": self.table_name, "Item": _low_level_item(invite_item)}},
            ]
        )
        return {"householdId": household_id, "role": role, "profile": profile_item}

    def list_sensor_events(
        self,
        *,
        start: datetime,
        end: datetime,
        device_id: str | None = None,
        kind: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, str]]:
        from homehub_api.sensor_events import (
            SENSOR_EVENT_LIST_MAX,
            event_from_item,
            event_range_sk,
            iso_bound,
            validate_event_window,
        )

        validate_event_window(start=start, end=end)
        capped = min(max(limit, 1), SENSOR_EVENT_LIST_MAX)
        start_sk = event_range_sk(iso_bound(start))
        end_sk = event_range_sk(iso_bound(end))
        filter_expression: Any | None = None
        if device_id:
            filter_expression = Attr("deviceId").eq(device_id)
        if kind:
            kind_filter = Attr("kind").eq(kind)
            filter_expression = (
                filter_expression & kind_filter if filter_expression is not None else kind_filter
            )
        collected: list[dict[str, Any]] = []
        exclusive_start: dict[str, Any] | None = None
        while len(collected) < capped:
            page: dict[str, Any] = {
                "ScanIndexForward": False,
                "Limit": 1000 if filter_expression is not None else capped,
            }
            if filter_expression is not None:
                page["FilterExpression"] = filter_expression
            if exclusive_start:
                page["ExclusiveStartKey"] = exclusive_start
            result = self._query_sk_between(self.tenant_pk, start_sk, end_sk, **page)
            collected.extend(result.get("Items") or [])
            exclusive_start = result.get("LastEvaluatedKey")
            if not exclusive_start:
                break
        return [event_from_item(item) for item in collected[:capped]]
