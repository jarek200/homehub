from __future__ import annotations

from typing import Any

import boto3

from homehub_api.config import DEMO_TENANT_PK
from homehub_api.dynamo import sk_begins_with, sk_between
from homehub_api.household import household_id_from_pk
from homehub_api.store.commission import CommissionMixin
from homehub_api.store.devices import DeviceMixin
from homehub_api.store.hub_document import HubDocumentMixin
from homehub_api.store.membership import MembershipMixin


class HubStore(DeviceMixin, HubDocumentMixin, CommissionMixin, MembershipMixin):
    def __init__(self, table_name: str, tenant_pk: str = DEMO_TENANT_PK):
        self.table_name = table_name
        self.tenant_pk = tenant_pk
        self._table = boto3.resource("dynamodb").Table(table_name)

    @property
    def household_id(self) -> str:
        return household_id_from_pk(self.tenant_pk)

    def _query_sk_prefix(self, pk: str, prefix: str, **kwargs: Any) -> dict[str, Any]:
        return self._table.query(
            KeyConditionExpression=sk_begins_with(pk, prefix),
            **kwargs,
        )

    def _query_sk_between(
        self, pk: str, start_sk: str, end_sk: str, **kwargs: Any
    ) -> dict[str, Any]:
        return self._table.query(
            KeyConditionExpression=sk_between(pk, start_sk, end_sk),
            **kwargs,
        )
