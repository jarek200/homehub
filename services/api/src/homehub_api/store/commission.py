from __future__ import annotations

from typing import Any

from homehub_api.errors import ApiError
from homehub_api.household import HOUSEHOLD_LOOKUP_SK, gateway_pk
from homehub_api.store._mapping import _now_iso
from homehub_api.store._surface import StoreSurface


class CommissionMixin(StoreSurface):
    def put_commission_job(self, job: dict[str, Any]) -> dict[str, Any]:
        timestamp = job.get("updatedAt") or _now_iso()
        item = {
            "PK": self.tenant_pk,
            "SK": f"COMMISSION#{job['commissionId']}",
            **job,
            "updatedAt": timestamp,
        }
        self._table.put_item(Item=item)
        self._table.put_item(
            Item={
                "PK": f"GATEWAY#{job['gatewayId']}",
                "SK": f"PAIR#{job['nodeId']}",
                "commissionId": job["commissionId"],
                "tenantPk": self.tenant_pk,
                "status": job["status"],
                "updatedAt": timestamp,
            }
        )
        return job

    def get_commission_job(self, commission_id: str) -> dict[str, Any] | None:
        result = self._table.get_item(
            Key={"PK": self.tenant_pk, "SK": f"COMMISSION#{commission_id}"}
        )
        item = result.get("Item")
        return dict(item) if item else None

    def update_commission_job(self, commission_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        job = self.get_commission_job(commission_id)
        if job is None:
            raise ApiError("Commission job not found", 404, "NotFound")
        job.update(updates)
        job["updatedAt"] = _now_iso()
        return self.put_commission_job(job)

    def list_pairing_node_ids(self, gateway_id: str) -> list[int]:
        nodes: list[int] = []
        result = self._query_sk_prefix(f"GATEWAY#{gateway_id}", "PAIR#")
        for item in result.get("Items") or []:
            if str(item.get("status") or "") != "pairing":
                continue
            sk = str(item.get("SK") or "")
            suffix = sk.removeprefix("PAIR#")
            if suffix.isdigit():
                nodes.append(int(suffix))
        return nodes

    def put_pair_result(
        self, gateway_id: str, node_id: int, event: str, error: str | None = None
    ) -> dict[str, Any]:
        item = {
            "PK": f"GATEWAY#{gateway_id}",
            "SK": f"PAIR_RESULT#{node_id}",
            "event": event,
            "error": error,
            "updatedAt": _now_iso(),
        }
        self._table.put_item(Item=item)
        return item

    def get_pair_result(self, gateway_id: str, node_id: int) -> dict[str, Any] | None:
        result = self._table.get_item(
            Key={"PK": f"GATEWAY#{gateway_id}", "SK": f"PAIR_RESULT#{node_id}"}
        )
        item = result.get("Item")
        return dict(item) if item else None

    def put_gateway_household(self, gateway_id: str, household_id: str | None = None) -> None:
        hid = household_id or self.household_id
        self._table.put_item(
            Item={
                "PK": gateway_pk(gateway_id),
                "SK": HOUSEHOLD_LOOKUP_SK,
                "householdId": hid,
                "tenantPk": self.tenant_pk,
                "updatedAt": _now_iso(),
            }
        )
