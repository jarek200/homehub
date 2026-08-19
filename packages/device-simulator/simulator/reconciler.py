"""SQS long-poll reconciler: start/stop virtual MQTT devices."""

from __future__ import annotations

import json
import logging
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from simulator.device import VirtualDevice, resolve_iot_endpoint

logger = logging.getLogger(__name__)


class Reconciler:
    def __init__(self, *, table_name: str, queue_url: str) -> None:
        self.table_name = table_name
        self.queue_url = queue_url
        self._sqs = boto3.client("sqs")
        self._table = boto3.resource("dynamodb").Table(table_name)
        self._devices: dict[str, VirtualDevice] = {}
        self._iot_endpoint = resolve_iot_endpoint()

    def bootstrap_online_devices(self) -> None:
        """Restart virtual devices after a container deploy.

        SQS only delivers new events, so a fresh simulator process would otherwise
        sit idle until something toggles power or a device is provisioned again.
        """
        query_kwargs: dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq("SIMULATOR") & Key("SK").begins_with("DEVICE#"),
        }
        while True:
            response = self._table.query(**query_kwargs)
            for item in response.get("Items", []):
                if not item.get("enabled", True):
                    continue
                if item.get("runtimeKind") == "physical":
                    continue

                device_id = str(item.get("deviceId") or str(item["SK"]).removeprefix("DEVICE#"))
                tenant_pk = str(item.get("tenantPk", "HUB#demo"))
                device = self._table.get_item(
                    Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"}
                ).get("Item")
                if not device:
                    continue
                if device.get("lifecycleStatus") != "READY":
                    continue
                if device.get("status") != "ONLINE":
                    continue

                self._start_device(device_id)

            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            query_kwargs["ExclusiveStartKey"] = last_key

    def poll_once(self) -> None:
        response = self._sqs.receive_message(
            QueueUrl=self.queue_url,
            MaxNumberOfMessages=10,
            WaitTimeSeconds=20,
        )
        for message in response.get("Messages", []):
            self._handle_message(message)

    def _handle_message(self, message: dict[str, Any]) -> None:
        receipt = message["ReceiptHandle"]
        try:
            body = json.loads(message["Body"])
            event_type = body.get("eventType")
            device_id = body.get("deviceId")
            if not device_id:
                return

            if event_type == "DEVICE_STOP":
                self._stop_device(device_id)
            elif event_type == "DEVICE_READY":
                self._start_device(device_id)
        finally:
            self._sqs.delete_message(QueueUrl=self.queue_url, ReceiptHandle=receipt)

    def _start_device(self, device_id: str) -> None:
        registry = self._table.get_item(Key={"PK": "SIMULATOR", "SK": f"DEVICE#{device_id}"}).get(
            "Item"
        )
        if not registry or not registry.get("enabled", True):
            logger.info("Registry disabled or missing for %s", device_id)
            return
        if registry.get("runtimeKind") == "physical":
            logger.info("Skipping physical device %s in simulator", device_id)
            return

        tenant_pk = str(registry.get("tenantPk", "HUB#demo"))
        hub_id = tenant_pk.removeprefix("HUB#")
        device = self._table.get_item(Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"}).get("Item")
        if not device:
            logger.warning("Device config missing for %s", device_id)
            return

        if device_id in self._devices:
            logger.info("Device %s already running", device_id)
            return

        from simulator.telemetry import simulator_device_type

        virtual = VirtualDevice(
            device_id=device_id,
            hub_id=hub_id,
            thing_name=str(registry.get("thingName") or device.get("thingName") or f"homehub-{device_id}"),
            device_type=simulator_device_type(str(device.get("type", "humidity-sensor"))),
            configuration=device.get("configuration"),
            iot_endpoint=self._iot_endpoint,
            ssm_cert_prefix=registry.get("ssmCertPrefix"),
        )
        virtual.start()
        self._devices[device_id] = virtual
        logger.info("Started virtual device %s", device_id)

    def _stop_device(self, device_id: str) -> None:
        virtual = self._devices.pop(device_id, None)
        if virtual:
            virtual.stop()
            logger.info("Stopped virtual device %s", device_id)

    def stop_all(self) -> None:
        for device_id in list(self._devices):
            self._stop_device(device_id)
