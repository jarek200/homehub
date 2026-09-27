"""Attributes mixins read from HubStore. Declared here so the type checker can see them."""

from __future__ import annotations

from typing import Any

from homehub_api.pagination import DeviceListPage


class StoreSurface:
    table_name: str
    tenant_pk: str
    _table: Any

    def __init__(self, table_name: str, tenant_pk: str = "") -> None:
        raise NotImplementedError

    @property
    def household_id(self) -> str:
        raise NotImplementedError

    def _query_sk_prefix(self, pk: str, prefix: str, **kwargs: Any) -> dict[str, Any]:
        raise NotImplementedError

    def _query_sk_between(
        self, pk: str, start_sk: str, end_sk: str, **kwargs: Any
    ) -> dict[str, Any]:
        raise NotImplementedError

    def list_devices(self, *, limit: int = 50, cursor: str | None = None) -> DeviceListPage:
        raise NotImplementedError

    def update_hub_state(
        self,
        mutator: Any,
        *,
        extra_item_fields: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    def put_gateway_household(self, gateway_id: str, household_id: str | None = None) -> None:
        raise NotImplementedError

    def get_commission_job(self, commission_id: str) -> dict[str, Any] | None:
        raise NotImplementedError
