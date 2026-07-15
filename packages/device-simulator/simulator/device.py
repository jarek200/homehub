"""Per-device MQTT client: telemetry + shadow."""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import UTC, datetime
from typing import Any

from awscrt import io, mqtt
from awsiot import mqtt_connection_builder

from simulator.certs import load_cert_paths_for_device

logger = logging.getLogger(__name__)

TELEMETRY_TOPIC = "homehub/devices/{device_id}/telemetry"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class VirtualDevice:
    def __init__(
        self,
        *,
        device_id: str,
        hub_id: str,
        thing_name: str,
        device_type: str,
        configuration: str | None,
        iot_endpoint: str,
        ssm_cert_prefix: str | None = None,
    ) -> None:
        self.device_id = device_id
        self.hub_id = hub_id
        self.thing_name = thing_name
        self.device_type = device_type
        self.configuration = configuration
        self.iot_endpoint = iot_endpoint
        self.ssm_cert_prefix = ssm_cert_prefix
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._connection: mqtt.Connection | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name=f"device-{self.device_id}", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._connection:
            try:
                self._connection.disconnect().result(timeout=5)
            except Exception:
                logger.debug("Disconnect failed for %s", self.device_id, exc_info=True)
        if self._thread:
            self._thread.join(timeout=10)

    def _run(self) -> None:
        cert_path, key_path, ca_path = load_cert_paths_for_device(
            self.device_id,
            self.ssm_cert_prefix,
        )
        client_id = self.thing_name
        # First connect publishes immediately; reconnects wait a full reporting
        # interval first so a client-id clash can't spam telemetry every 10s.
        publish_immediately = True

        while not self._stop.is_set():
            try:
                event_loop_group = io.EventLoopGroup(1)
                host_resolver = io.DefaultHostResolver(event_loop_group)
                client_bootstrap = io.ClientBootstrap(event_loop_group, host_resolver)
                host_name = self.iot_endpoint.removeprefix("https://").removeprefix("ssl://")
                self._connection = mqtt_connection_builder.mtls_from_path(
                    endpoint=host_name,
                    cert_filepath=cert_path,
                    pri_key_filepath=key_path,
                    client_bootstrap=client_bootstrap,
                    ca_filepath=ca_path,
                    client_id=client_id,
                    clean_session=False,
                    keep_alive_secs=60,
                )
                connect_future = self._connection.connect()
                connect_future.result(timeout=10)
                logger.info("MQTT connected for %s", self.device_id)

                shadow_delta_topic = f"$aws/things/{self.thing_name}/shadow/update/delta"
                subscribe_future, _ = self._connection.subscribe(
                    topic=shadow_delta_topic,
                    qos=mqtt.QoS.AT_LEAST_ONCE,
                    callback=self._on_shadow_delta,
                )
                subscribe_future.result(timeout=5)

                if not publish_immediately:
                    interval = self._reporting_interval_seconds()
                    if self._stop.wait(interval):
                        break

                while not self._stop.is_set():
                    self._publish_telemetry()
                    interval = self._reporting_interval_seconds()
                    if self._stop.wait(interval):
                        break

                self._connection.disconnect().result(timeout=5)
                return
            except Exception:
                publish_immediately = False
                logger.exception("MQTT loop error for %s; retrying in 10s", self.device_id)
                if self._stop.wait(10):
                    return

    def _reporting_interval_seconds(self) -> int:
        if not self.configuration:
            return 10
        try:
            parsed = (
                self.configuration
                if isinstance(self.configuration, dict)
                else json.loads(self.configuration)
            )
            if not isinstance(parsed, dict):
                return 10
            value = int(parsed.get("reportingIntervalSeconds", 10))
            return value if value > 0 else 10
        except (json.JSONDecodeError, TypeError, ValueError):
            return 10

    def _publish_telemetry(self) -> None:
        if not self._connection:
            return

        payload = self._build_telemetry()
        topic = TELEMETRY_TOPIC.format(device_id=self.device_id)
        self._connection.publish(
            topic=topic,
            payload=json.dumps(payload),
            qos=mqtt.QoS.AT_LEAST_ONCE,
        ).result(timeout=5)
        logger.info("Published telemetry for %s", self.device_id)

    def _build_telemetry(self) -> dict[str, Any]:
        from simulator.telemetry import derive_alarm_state, parse_thresholds, sample_metrics

        recorded_at = _now_iso()
        metrics = sample_metrics(self.device_type, self.configuration)
        thresholds = parse_thresholds(self.configuration)
        alarm, state = derive_alarm_state(metrics, thresholds, self.device_type)
        return {
            "deviceId": self.device_id,
            "hubId": self.hub_id,
            "thingName": self.thing_name,
            "recordedAt": recorded_at,
            "alarm": alarm,
            "state": state,
            "metrics": metrics,
        }

    def _on_shadow_delta(
        self,
        topic: str,
        payload: bytes,
        dup: bool,
        qos: mqtt.QoS,
        retain: bool,
        **kwargs: Any,
    ) -> None:
        if not self._connection:
            return
        try:
            from simulator.shadow_config import apply_shadow_state

            delta = json.loads(payload.decode())
            state = delta.get("state")
            if not isinstance(state, dict):
                state = delta if isinstance(delta, dict) else {}

            configuration, reported_state = apply_shadow_state(
                configuration=self.configuration,
                device_type=self.device_type,
                state=state,
            )
            if configuration is not None:
                self.configuration = configuration

            if not reported_state:
                return

            reported_topic = f"$aws/things/{self.thing_name}/shadow/update"
            response = {"state": {"reported": reported_state}}
            self._connection.publish(
                topic=reported_topic,
                payload=json.dumps(response),
                qos=mqtt.QoS.AT_LEAST_ONCE,
            )
            logger.info("Applied shadow delta for %s", self.device_id)
        except Exception:
            logger.exception("Failed to apply shadow delta for %s", self.device_id)


def resolve_iot_endpoint() -> str:
    endpoint = __import__("os").environ.get("IOT_ENDPOINT", "").strip()
    if endpoint:
        return endpoint
    import boto3

    host = boto3.client("iot").describe_endpoint(endpointType="iot:Data-ATS")["endpointAddress"]
    return f"https://{host}"
