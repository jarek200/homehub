from __future__ import annotations

from typing import Any

from homehub_api.models import DeviceResponse
from homehub_api.revisions import commit_hub_state, read_hub_state_item, revision_of
from homehub_api.store._mapping import _now_iso
from homehub_api.store._surface import StoreSurface


class HubDocumentMixin(StoreSurface):
    def get_hub_state(self) -> dict[str, Any]:
        from homehub_api.cores3_fabric import is_legacy_dummy_household_state
        from homehub_api.hub_state import (
            default_household_state,
            jsonable_plan,
            normalize_household_state,
        )

        item = read_hub_state_item(self._table, self.tenant_pk)
        if item and isinstance(item.get("state"), dict):
            raw = item["state"]
            state = normalize_household_state(raw)
            if item.get("revision") is not None and state.get("stateVersion") is None:
                state["stateVersion"] = revision_of(item, raw)
            if is_legacy_dummy_household_state(raw):
                return self.update_hub_state(lambda _current: state)
            converted = jsonable_plan(state)
            return converted if isinstance(converted, dict) else state
        return self.update_hub_state(lambda current: current or default_household_state())

    def update_hub_state(
        self,
        mutator: Any,
        *,
        extra_item_fields: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        from homehub_api.hub_state import jsonable_plan

        state = commit_hub_state(
            self._table,
            self.tenant_pk,
            mutator,
            extra_item_fields=extra_item_fields,
        )
        converted = jsonable_plan(state)
        return converted if isinstance(converted, dict) else state

    def put_hub_state(self, state: dict[str, Any]) -> dict[str, Any]:
        return self.update_hub_state(lambda _current: state)

    def _floor_plan_item(self) -> dict[str, Any] | None:
        from homehub_api.hub_state import FLOOR_PLAN_SK

        result = self._table.get_item(Key={"PK": self.tenant_pk, "SK": FLOOR_PLAN_SK})
        item = result.get("Item")
        return item if isinstance(item, dict) else None

    def get_floor_plan(self) -> dict[str, Any] | None:
        item = self._floor_plan_item()
        plan = item.get("plan") if item else None
        if not isinstance(plan, dict):
            return None
        from homehub_api.hub_state import jsonable_plan

        converted = jsonable_plan(plan)
        return converted if isinstance(converted, dict) else None

    def get_floor_plan_library(self) -> dict[str, Any] | None:
        item = self._floor_plan_item()
        library = item.get("library") if item else None
        if not isinstance(library, dict):
            return None
        from homehub_api.hub_state import jsonable_plan

        converted = jsonable_plan(library)
        return converted if isinstance(converted, dict) else None

    def get_floor_plan_document(self) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        item = self._floor_plan_item()
        if not item:
            return None, None
        from homehub_api.hub_state import jsonable_plan

        plan = item.get("plan")
        library = item.get("library")
        converted_plan = jsonable_plan(plan) if isinstance(plan, dict) else None
        converted_library = jsonable_plan(library) if isinstance(library, dict) else None
        return (
            converted_plan if isinstance(converted_plan, dict) else None,
            converted_library if isinstance(converted_library, dict) else None,
        )

    def put_floor_plan(
        self, plan: dict[str, Any], library: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        from homehub_api.hub_state import (
            FLOOR_PLAN_SK,
            dynamo_json,
            jsonable_plan,
            upsert_plan_library,
        )

        stored = dynamo_json(plan)
        stored_library = library
        if stored_library is None:
            existing = self.get_floor_plan_library()
            if existing is not None:
                stored_library = upsert_plan_library(existing, plan)
        item: dict[str, Any] = {
            "PK": self.tenant_pk,
            "SK": FLOOR_PLAN_SK,
            "plan": stored,
            "updatedAt": _now_iso(),
        }
        if stored_library is not None:
            item["library"] = dynamo_json(stored_library)
        self._table.put_item(Item=item)
        converted = jsonable_plan(stored)
        return converted if isinstance(converted, dict) else plan

    def apply_household_command(self, command: str) -> dict[str, Any]:
        from homehub_api.hub_state import apply_hub_command

        return self.update_hub_state(lambda current: apply_hub_command(current, command))

    def apply_household_device(
        self,
        kind: str,
        device_id: str,
        on: bool | None = None,
        brightness: int | None = None,
    ) -> dict[str, Any]:
        from homehub_api.hub_state import apply_hub_device

        return self.update_hub_state(
            lambda current: apply_hub_device(current, kind, device_id, on, brightness)
        )

    def find_matter_gateway(self) -> DeviceResponse | None:
        page = self.list_devices(limit=50)
        for device in page.items:
            if device.type == "matter-gateway":
                return device
        return None

    def get_hub_rules(self) -> list[dict[str, Any]]:
        result = self._table.get_item(Key={"PK": self.tenant_pk, "SK": "HUB_RULES"})
        item = result.get("Item")
        rules = item.get("rules") if item else None
        return list(rules) if isinstance(rules, list) else []

    def put_hub_rules(self, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        self._table.put_item(
            Item={
                "PK": self.tenant_pk,
                "SK": "HUB_RULES",
                "rules": rules,
                "updatedAt": _now_iso(),
            }
        )
        return rules
