from __future__ import annotations

from typing import Any

from homehub_api.device_configuration import (
    as_config_json,
    configuration_for_create,
    normalize_configuration_update,
)
from homehub_api.dynamo import set_update
from homehub_api.errors import ApiError
from homehub_api.household import DEVICE_SK_PREFIX, device_sk
from homehub_api.models import (
    CreateDeviceRequest,
    DeviceResponse,
    ReadingResponse,
    UpdateDeviceRequest,
)
from homehub_api.pagination import DeviceListPage, decode_device_cursor, encode_device_cursor
from homehub_api.store._mapping import _new_id, _now_iso, _safe_to_device, _to_device, _to_reading
from homehub_api.store._surface import StoreSurface


class DeviceMixin(StoreSurface):
    def list_devices(self, *, limit: int = 50, cursor: str | None = None) -> DeviceListPage:
        query_kwargs: dict[str, Any] = {"Limit": limit}
        if cursor:
            query_kwargs["ExclusiveStartKey"] = decode_device_cursor(cursor)

        result = self._query_sk_prefix(self.tenant_pk, DEVICE_SK_PREFIX, **query_kwargs)
        devices: list[DeviceResponse] = []
        for item in result.get("Items", []):
            device = _safe_to_device(item)
            if device is not None:
                devices.append(device)

        last_key = result.get("LastEvaluatedKey")
        next_cursor = encode_device_cursor(last_key) if last_key else None
        return DeviceListPage(items=devices, next_cursor=next_cursor)

    def get_device(self, device_id: str) -> DeviceResponse | None:
        result = self._table.get_item(Key={"PK": self.tenant_pk, "SK": device_sk(device_id)})
        item = result.get("Item")
        return _safe_to_device(item) if item else None

    def list_all_devices(self) -> list[DeviceResponse]:
        items: list[DeviceResponse] = []
        cursor: str | None = None
        while True:
            page = self.list_devices(limit=50, cursor=cursor)
            items.extend(page.items)
            cursor = page.next_cursor
            if not cursor:
                break
        return items

    def create_device(
        self, payload: CreateDeviceRequest, device_id: str | None = None
    ) -> DeviceResponse:
        device_id = device_id or _new_id()
        if self.get_device(device_id):
            raise ApiError("Device already exists", 409, "Conflict")
        timestamp = _now_iso()
        is_matter_child = payload.runtime_kind == "matter"
        item: dict[str, Any] = {
            "PK": self.tenant_pk,
            "SK": device_sk(device_id),
            "deviceId": device_id,
            "name": payload.name,
            "type": payload.type,
            "location": payload.location,
            "runtimeKind": payload.runtime_kind,
            "configuration": configuration_for_create(
                payload.type,
                payload.configuration,
                runtime_kind=payload.runtime_kind,
            ),
            "status": "ONLINE" if is_matter_child else "UNKNOWN",
            "lifecycleStatus": "READY" if is_matter_child else "PROVISIONING",
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
        if payload.gateway_id:
            item["gatewayId"] = payload.gateway_id
        if payload.node_id is not None:
            item["nodeId"] = payload.node_id
        if payload.endpoint is not None:
            item["endpoint"] = payload.endpoint
        if payload.clusters:
            item["clusters"] = payload.clusters
        self._table.put_item(Item=item)
        if payload.type == "matter-gateway" or payload.gateway_id:
            self.put_gateway_household(payload.gateway_id or device_id)
        return _to_device(item)

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

        if "configuration" in updates:
            updates["configuration"] = normalize_configuration_update(
                existing.type,
                existing.runtime_kind,
                existing.configuration,
                payload.configuration,
            )

        result = self._table.update_item(
            Key={"PK": self.tenant_pk, "SK": device_sk(device_id)},
            ReturnValues="ALL_NEW",
            **set_update({**updates, "updatedAt": _now_iso()}),
        )
        updated = _to_device(result["Attributes"])
        if (
            payload.configuration is not None
            and as_config_json(payload.configuration) != as_config_json(existing.configuration)
            and updated.lifecycle_status == "READY"
        ):
            self._push_device_shadow_configuration(updated)
        return updated

    def _push_device_shadow_configuration(self, device: DeviceResponse) -> None:
        from homehub_api.iot.shadow import push_device_shadow_desired

        push_device_shadow_desired(
            device_id=device.device_id,
            device_type=device.type,
            configuration=as_config_json(device.configuration),
            thing_name=device.thing_name,
        )

    def delete_device(self, device_id: str) -> dict[str, Any]:
        device = self.get_device(device_id)
        if not device:
            raise ApiError("Device not found", 404, "NotFound")

        from homehub_api.iot.decommission import decommission_device_resources

        decommission_device_resources(
            device_id=device_id,
            certificate_id=device.certificate_id,
            thing_name=device.thing_name,
        )
        self._decommission_device(device_id)
        self._table.delete_item(Key={"PK": self.tenant_pk, "SK": device_sk(device_id)})
        if device.runtime_kind == "matter":
            self.remove_household_device(device_id)
            from homehub_api.matter_devices import publish_store_fabric

            publish_store_fabric(self)
        return {"deleted": True, "deviceId": device_id}

    def add_household_device(self, household: str, card: dict[str, Any]) -> dict[str, Any]:
        from homehub_api.cores3_products import upsert_household_item

        return self.update_hub_state(
            lambda current: upsert_household_item(current, household, card)
        )

    def remove_household_device(self, device_id: str) -> dict[str, Any]:
        from homehub_api.cores3_products import remove_household_item

        return self.update_hub_state(lambda current: remove_household_item(current, device_id))

    def _decommission_device(self, device_id: str) -> None:
        try:
            from homehub_api.device_registry import delete_registry_items

            delete_registry_items(self._table, device_id)
        except Exception:
            pass

    def list_readings(self, device_id: str, limit: int = 50) -> list[ReadingResponse]:
        device = self._require_device(device_id)
        result = self._query_sk_prefix(
            self.tenant_pk,
            f"READING#{device_id}#",
            ScanIndexForward=False,
            Limit=limit,
        )
        from homehub_api.iot.telemetry import reading_is_live

        return [
            _to_reading(
                item,
                configuration=device.configuration,
                device_type=device.type,
            )
            for item in result.get("Items", [])
            if reading_is_live(item)
        ]

    def _require_device(self, device_id: str) -> DeviceResponse:
        device = self.get_device(device_id)
        if not device:
            raise ApiError("Device not found", 404, "NotFound")
        return device
