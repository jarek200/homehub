"""Publish remote commands to a CoreS3 Matter gateway Thing."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlparse

import boto3

from homehub_api.observability import logger

MAX_GATEWAY_CONFIG_BYTES = 3500
MAX_GATEWAY_FABRIC_BYTES = 3500


def firmware_ota_payload(gateway_id: str, url: str) -> dict[str, Any]:
    if not url.startswith("https://"):
        raise ValueError("OTA url must be https")
    host = (urlparse(url).hostname or "").lower()
    if not (host == "amazonaws.com" or host.endswith(".amazonaws.com")):
        raise ValueError("OTA url host is not allowed")
    return {
        "command": "ota",
        "url": url,
        "gatewayId": gateway_id,
        "source": "ota",
    }


def _iot_data_client():
    endpoint = os.environ.get("IOT_DATA_ENDPOINT", "").strip()
    if not endpoint:
        return None
    host = urlparse(endpoint).hostname or endpoint.replace("https://", "")
    return boto3.client("iot-data", endpoint_url=f"https://{host}")


def publish_gateway_pair(gateway_id: str, node_id: int, setup_payload: str) -> None:
    client = _iot_data_client()
    if client is None:
        return
    payload = {
        "command": "pair",
        "node": node_id,
        "code": setup_payload,
        "gatewayId": gateway_id,
        "source": "commission",
    }
    topic = f"homehub/gateways/{gateway_id}/commands"
    client.publish(topic=topic, qos=1, payload=json.dumps(payload))
    logger.info(
        "Published pair command",
        extra={"gateway_id": gateway_id, "node_id": node_id},
    )


def runtime_device_command(
    kind: str,
    device_id: str,
    on: bool | None = None,
    brightness: int | None = None,
) -> str:
    """Command string the current CoreS3 firmware already understands."""
    if kind == "light":
        if brightness is not None:
            percent = max(0, min(100, int(brightness)))
            return f"light-bri-{device_id}-{percent}"
        return f"light-on-{device_id}" if on else f"light-off-{device_id}"
    if device_id == "matter-10":
        return "plug-on-11" if on else "plug-off-11"
    return "plug-on" if on else "plug-off"


def publish_gateway_command(gateway_id: str, command: str, thing_name: str | None = None) -> None:
    client = _iot_data_client()
    if client is None:
        return
    payload: dict[str, Any] = {
        "command": command,
        "gatewayId": gateway_id,
        "source": "homehub",
    }
    topic = f"homehub/gateways/{gateway_id}/commands"
    client.publish(topic=topic, qos=1, payload=json.dumps(payload))
    logger.info(
        "Published gateway command",
        extra={"gateway_id": gateway_id, "command": command, "thing_name": thing_name},
    )


def compact_runtime_plan(plan: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {
        "version": 1,
        "width": plan.get("width"),
        "height": plan.get("height"),
        "rooms": [],
        "sensors": [],
    }
    for key in ("id", "name"):
        if plan.get(key) is not None:
            compact[key] = plan[key]
    for room in plan.get("rooms", []):
        if not isinstance(room, dict):
            continue
        item = {
            key: room[key]
            for key in ("id", "name", "x", "y", "w", "h", "points", "label")
            if room.get(key) is not None
        }
        compact["rooms"].append(item)
    for sensor in plan.get("sensors", []):
        if not isinstance(sensor, dict):
            continue
        item = {
            key: sensor[key]
            for key in ("id", "kind", "label", "x", "y", "deviceId")
            if sensor.get(key) is not None
        }
        compact["sensors"].append(item)
    encoded = json.dumps({"kind": "plan", "plan": compact}, separators=(",", ":"))
    if len(encoded.encode()) > MAX_GATEWAY_CONFIG_BYTES:
        raise ValueError(f"Compact floor plan exceeds {MAX_GATEWAY_CONFIG_BYTES} bytes")
    return compact


def compact_runtime_fabric(fabric: dict[str, Any]) -> dict[str, Any]:
    devices = fabric.get("devices")
    if not isinstance(devices, list):
        devices = []
    compact_devices: list[dict[str, Any]] = []
    for device in devices:
        if not isinstance(device, dict) or not device.get("id") or device.get("n") is None:
            continue
        reads = []
        for read in device.get("reads") or []:
            if not isinstance(read, dict):
                continue
            if read.get("e") is None or read.get("c") is None:
                continue
            reads.append(
                {
                    "e": int(read["e"]),
                    "c": int(read["c"]),
                    "a": int(read.get("a") or 0),
                }
            )
        compact_devices.append(
            {
                "id": str(device["id"]),
                "name": str(device.get("name") or device["id"]),
                "type": str(device.get("type") or "climate"),
                "n": int(device["n"]),
                "reads": reads,
            }
        )
    compact = {"kind": "fabric", "devices": compact_devices}
    encoded = json.dumps(compact, separators=(",", ":"))
    if len(encoded.encode()) > MAX_GATEWAY_FABRIC_BYTES:
        raise ValueError(f"Fabric config exceeds {MAX_GATEWAY_FABRIC_BYTES} bytes")
    return compact


def publish_gateway_fabric(gateway_id: str, fabric: dict[str, Any]) -> None:
    client = _iot_data_client()
    if client is None:
        return
    payload = json.dumps(compact_runtime_fabric(fabric), separators=(",", ":"))
    client.publish(
        topic=f"homehub/gateways/{gateway_id}/fabric",
        qos=1,
        retain=True,
        payload=payload,
    )
    logger.info("Published gateway fabric", extra={"gateway_id": gateway_id})


def publish_gateway_plan(gateway_id: str, plan: dict[str, Any]) -> None:
    client = _iot_data_client()
    if client is None:
        return
    payload = json.dumps(
        {"kind": "plan", "gatewayId": gateway_id, "plan": compact_runtime_plan(plan)},
        separators=(",", ":"),
    )
    client.publish(
        topic=f"homehub/gateways/{gateway_id}/config",
        qos=1,
        retain=True,
        payload=payload,
    )
    logger.info("Published gateway floor plan", extra={"gateway_id": gateway_id})
