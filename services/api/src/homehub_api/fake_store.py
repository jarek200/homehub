"""In-memory store for tests and local development only."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

from ulid import new as new_ulid

from homehub_api.config import DEMO_TENANT_PK
from homehub_api.device_configuration import DeviceConfiguration, configuration_for_create
from homehub_api.errors import ApiError
from homehub_api.household import household_id_from_pk
from homehub_api.hub_state import (
    apply_hub_command,
    apply_hub_device,
    default_household_state,
    normalize_household_state,
    upsert_plan_library,
)
from homehub_api.models import (
    CreateDeviceRequest,
    DeviceResponse,
    ReadingResponse,
    UpdateDeviceRequest,
)
from homehub_api.pagination import (
    DeviceListPage,
    decode_device_cursor,
    encode_device_cursor,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    return str(new_ulid())


class FakeHubStore:
    def __init__(self) -> None:
        self.devices: dict[str, DeviceResponse] = {}
        self.readings: dict[str, list[ReadingResponse]] = {}
        self.hub_state: dict[str, Any] | None = None
        self.hub_plan: dict[str, Any] | None = None
        self.hub_library: dict[str, Any] | None = None
        self.hub_rules: list[dict[str, Any]] = []
        self.commissions: dict[str, dict[str, Any]] = {}
        self.pair_index: dict[tuple[str, int], dict[str, Any]] = {}
        self.pair_results: dict[tuple[str, int], dict[str, Any]] = {}
        self.table_name = "fake"
        self.tenant_pk = DEMO_TENANT_PK
        self._table = None
        self.revision = 0
        self.profiles: dict[str, dict[str, Any]] = {}
        self.members: dict[str, dict[str, Any]] = {}
        self.invites: dict[str, dict[str, Any]] = {}
        self.invite_tokens: dict[str, dict[str, Any]] = {}
        self.gateway_households: dict[str, dict[str, Any]] = {}
        self.household_metadata: dict[str, Any] | None = None
        self.sensor_events: list[dict[str, str]] = []

    @property
    def household_id(self) -> str:
        return household_id_from_pk(self.tenant_pk)

    def list_all_devices(self) -> list[DeviceResponse]:
        return sorted(self.devices.values(), key=lambda device: device.device_id)

    def list_devices(self, *, limit: int = 50, cursor: str | None = None) -> DeviceListPage:
        sorted_devices = sorted(self.devices.values(), key=lambda device: device.device_id)
        start_idx = 0
        if cursor:
            key = decode_device_cursor(cursor)
            after_id = key["SK"].removeprefix("DEVICE#")
            for index, device in enumerate(sorted_devices):
                if device.device_id == after_id:
                    start_idx = index + 1
                    break

        page = sorted_devices[start_idx : start_idx + limit]
        next_cursor = None
        if start_idx + limit < len(sorted_devices) and page:
            last = page[-1]
            next_cursor = encode_device_cursor(
                {"PK": DEMO_TENANT_PK, "SK": f"DEVICE#{last.device_id}"}
            )
        return DeviceListPage(items=page, next_cursor=next_cursor)

    def get_device(self, device_id: str) -> DeviceResponse | None:
        return self.devices.get(device_id)

    def create_device(
        self, payload: CreateDeviceRequest, device_id: str | None = None
    ) -> DeviceResponse:
        device_id = device_id or _new_id()
        if device_id in self.devices:
            raise ApiError("Device already exists", 409, "Conflict")
        timestamp = _now_iso()
        is_matter_child = payload.runtime_kind == "matter"
        device = DeviceResponse(
            deviceId=device_id,
            name=payload.name,
            type=payload.type,
            location=payload.location,
            runtimeKind=payload.runtime_kind,
            gatewayId=payload.gateway_id,
            nodeId=payload.node_id,
            endpoint=payload.endpoint,
            clusters=payload.clusters,
            status="ONLINE" if is_matter_child else "UNKNOWN",
            lifecycleStatus="READY" if is_matter_child else "PROVISIONING",
            configuration=cast(
                DeviceConfiguration | None,
                configuration_for_create(
                    payload.type,
                    payload.configuration,
                    runtime_kind=payload.runtime_kind,
                ),
            ),
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        self.devices[device_id] = device
        return device

    def update_device(self, device_id: str, payload: UpdateDeviceRequest) -> DeviceResponse:
        existing = self.get_device(device_id)
        if not existing:
            raise ApiError("Device not found", 404, "NotFound")

        updates = payload.model_dump(exclude_none=True, by_alias=True)
        if not updates:
            raise ApiError("At least one field is required", 400, "ValidationError")

        if payload.type is not None and payload.type != existing.type:
            raise ApiError(
                "Device type cannot be changed after registration",
                400,
                "ValidationError",
            )
        updates.pop("type", None)

        data = existing.model_dump(by_alias=True)
        data.update(updates)
        data["updatedAt"] = _now_iso()
        updated = DeviceResponse.model_validate(data)
        self.devices[device_id] = updated
        return updated

    def delete_device(self, device_id: str) -> dict[str, Any]:
        device = self.devices.get(device_id)
        if not device:
            raise ApiError("Device not found", 404, "NotFound")
        del self.devices[device_id]
        if device.runtime_kind == "matter":
            self.remove_household_device(device_id)
        return {"deleted": True, "deviceId": device_id}

    def add_household_device(self, household: str, card: dict[str, Any]) -> dict[str, Any]:
        from homehub_api.cores3_products import upsert_household_item

        return self.update_hub_state(
            lambda current: upsert_household_item(current, household, card)
        )

    def remove_household_device(self, device_id: str) -> dict[str, Any]:
        from homehub_api.cores3_products import remove_household_item

        return self.update_hub_state(lambda current: remove_household_item(current, device_id))

    def list_readings(self, device_id: str, limit: int = 50) -> list[ReadingResponse]:
        self._require_device(device_id)
        return (self.readings.get(device_id) or [])[:limit]

    def get_hub_state(self) -> dict[str, Any]:
        if self.hub_state is None:
            self.hub_state = default_household_state()
        return normalize_household_state(self.hub_state)

    def update_hub_state(
        self,
        mutator: Any,
        *,
        extra_item_fields: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        current = self.get_hub_state()
        next_state = mutator(current)
        self.revision += 1
        next_state = {**next_state, "stateVersion": self.revision, "updatedAt": _now_iso()}
        self.hub_state = next_state
        return next_state

    def put_hub_state(self, state: dict[str, Any]) -> dict[str, Any]:
        return self.update_hub_state(lambda _current: state)

    def get_floor_plan(self) -> dict[str, Any] | None:
        return self.hub_plan

    def get_floor_plan_library(self) -> dict[str, Any] | None:
        return self.hub_library

    def get_floor_plan_document(self) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        return self.hub_plan, self.hub_library

    def put_floor_plan(
        self, plan: dict[str, Any], library: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        self.hub_plan = plan
        if library is not None:
            self.hub_library = library
        elif self.hub_library is not None:
            self.hub_library = upsert_plan_library(self.hub_library, plan)
        return plan

    def apply_household_command(self, command: str) -> dict[str, Any]:
        return self.update_hub_state(lambda current: apply_hub_command(current, command))

    def apply_household_device(
        self,
        kind: str,
        device_id: str,
        on: bool | None = None,
        brightness: int | None = None,
    ) -> dict[str, Any]:
        return self.update_hub_state(
            lambda current: apply_hub_device(current, kind, device_id, on, brightness)
        )

    def find_matter_gateway(self) -> DeviceResponse | None:
        for device in self.devices.values():
            if device.type == "matter-gateway":
                return device
        return None

    def get_hub_rules(self) -> list[dict[str, Any]]:
        return self.hub_rules

    def put_hub_rules(self, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        self.hub_rules = rules
        return rules

    def put_commission_job(self, job: dict[str, Any]) -> dict[str, Any]:
        stored = dict(job)
        stored["updatedAt"] = stored.get("updatedAt") or _now_iso()
        self.commissions[str(stored["commissionId"])] = stored
        self.pair_index[(str(stored["gatewayId"]), int(stored["nodeId"]))] = {
            "commissionId": stored["commissionId"],
            "tenantPk": self.tenant_pk,
            "status": stored["status"],
        }
        return stored

    def get_commission_job(self, commission_id: str) -> dict[str, Any] | None:
        job = self.commissions.get(commission_id)
        return dict(job) if job else None

    def update_commission_job(self, commission_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        job = self.get_commission_job(commission_id)
        if job is None:
            raise ApiError("Commission job not found", 404, "NotFound")
        job.update(updates)
        job["updatedAt"] = _now_iso()
        return self.put_commission_job(job)

    def get_commission_by_node(self, gateway_id: str, node_id: int) -> dict[str, Any] | None:
        pointer = self.pair_index.get((gateway_id, node_id))
        if pointer is None:
            return None
        return self.get_commission_job(str(pointer["commissionId"]))

    def list_pairing_node_ids(self, gateway_id: str) -> list[int]:
        return [
            node_id
            for (gateway, node_id), pointer in self.pair_index.items()
            if gateway == gateway_id and pointer.get("status") == "pairing"
        ]

    def put_pair_result(
        self, gateway_id: str, node_id: int, event: str, error: str | None = None
    ) -> dict[str, Any]:
        item = {"event": event, "error": error, "updatedAt": _now_iso()}
        self.pair_results[(gateway_id, node_id)] = item
        return item

    def get_pair_result(self, gateway_id: str, node_id: int) -> dict[str, Any] | None:
        item = self.pair_results.get((gateway_id, node_id))
        return dict(item) if item else None

    def get_profile(self, user_id: str) -> dict[str, Any] | None:
        item = self.profiles.get(user_id)
        return dict(item) if item else None

    def put_profile(self, user_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        existing = self.get_profile(user_id) or {
            "userId": user_id,
            "createdAt": _now_iso(),
        }
        item = {**existing, **updates, "userId": user_id, "updatedAt": _now_iso()}
        self.profiles[user_id] = item
        return item

    def get_household_metadata(self) -> dict[str, Any] | None:
        return dict(self.household_metadata) if self.household_metadata else None

    def put_household_metadata(self, record: dict[str, Any]) -> dict[str, Any]:
        timestamp = _now_iso()
        item = {
            "householdId": self.household_id,
            "createdAt": record.get("createdAt") or timestamp,
            **record,
            "updatedAt": timestamp,
        }
        self.household_metadata = item
        return item

    def get_member(self, user_id: str) -> dict[str, Any] | None:
        item = self.members.get(user_id)
        return dict(item) if item else None

    def put_member(self, record: dict[str, Any]) -> dict[str, Any]:
        user_id = str(record["userId"])
        timestamp = _now_iso()
        item = {
            "householdId": self.household_id,
            "createdAt": record.get("createdAt") or timestamp,
            **record,
            "updatedAt": timestamp,
        }
        self.members[user_id] = item
        return item

    def delete_member(self, user_id: str) -> None:
        self.members.pop(user_id, None)

    def list_members(self) -> list[dict[str, Any]]:
        return [dict(item) for item in self.members.values()]

    def list_invites(self) -> list[dict[str, Any]]:
        return [dict(item) for item in self.invites.values()]

    def get_invite(self, invite_id: str) -> dict[str, Any] | None:
        item = self.invites.get(invite_id)
        return dict(item) if item else None

    def put_invite(self, record: dict[str, Any], token_hash: str | None = None) -> dict[str, Any]:
        invite_id = str(record["inviteId"])
        timestamp = _now_iso()
        item = {
            "householdId": self.household_id,
            "createdAt": record.get("createdAt") or timestamp,
            **record,
            "updatedAt": timestamp,
        }
        self.invites[invite_id] = item
        if token_hash:
            self.invite_tokens[token_hash] = {
                "inviteId": invite_id,
                "householdId": self.household_id,
                "tenantPk": self.tenant_pk,
                "emailHash": record.get("emailHash"),
                "status": record.get("status", "pending"),
                "role": record.get("role", "MEMBER"),
                "expiresAt": record.get("expiresAt"),
                "updatedAt": timestamp,
            }
        return item

    def delete_invite_token(self, token_hash: str) -> None:
        self.invite_tokens.pop(token_hash, None)

    def get_invite_by_token_hash(self, token_hash: str) -> dict[str, Any] | None:
        item = self.invite_tokens.get(token_hash)
        return dict(item) if item else None

    def put_gateway_household(self, gateway_id: str, household_id: str | None = None) -> None:
        self.gateway_households[gateway_id] = {
            "householdId": household_id or self.household_id,
            "tenantPk": self.tenant_pk,
            "updatedAt": _now_iso(),
        }

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
        lookup = self.invite_tokens.get(token_hash)
        if not lookup or lookup.get("status") != "pending":
            raise ApiError("Invitation is no longer valid", 409, "Conflict")
        timestamp = _now_iso()
        household_id = str(invite["householdId"])
        role = str(invite.get("role") or "MEMBER")
        lookup["status"] = "accepted"
        lookup["updatedAt"] = timestamp
        invite_id = str(invite["inviteId"])
        stored = {
            **invite,
            "status": "accepted",
            "acceptedBy": user_id,
            "updatedAt": timestamp,
        }
        self.invites[invite_id] = stored
        self.put_member(
            {"userId": user_id, "email": email, "role": role, "householdId": household_id}
        )
        profile_item = self.put_profile(
            user_id,
            {
                **(profile or {}),
                "email": email,
                "username": username,
                "householdId": household_id,
                "role": role,
            },
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
        from homehub_api.sensor_events import SENSOR_EVENT_LIST_MAX, validate_event_window

        validate_event_window(start=start, end=end)
        capped = min(max(limit, 1), SENSOR_EVENT_LIST_MAX)

        def event_at(event: dict[str, str]) -> datetime:
            return datetime.fromisoformat(event["at"].replace("Z", "+00:00"))

        rows = [event for event in self.sensor_events if start <= event_at(event) < end]
        if device_id:
            rows = [event for event in rows if event["deviceId"] == device_id]
        if kind:
            rows = [event for event in rows if event["kind"] == kind]
        rows.sort(key=lambda event: event["at"], reverse=True)
        return rows[:capped]

    def _require_device(self, device_id: str) -> DeviceResponse:
        device = self.get_device(device_id)
        if not device:
            raise ApiError("Device not found", 404, "NotFound")
        return device
