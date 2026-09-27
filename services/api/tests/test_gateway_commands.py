import pytest

from homehub_api.iot.gateway_commands import (
    compact_runtime_plan,
    firmware_ota_payload,
    runtime_device_command,
)


def test_runtime_device_command_matches_firmware() -> None:
    assert runtime_device_command("light", "matter-1", on=False) == "light-off-matter-1"
    assert runtime_device_command("light", "matter-1", brightness=40) == "light-bri-matter-1-40"
    assert runtime_device_command("plug", "matter-9", on=True) == "plug-on"
    assert runtime_device_command("plug", "matter-10", on=False) == "plug-off-11"


def test_firmware_ota_payload_allows_s3_virtual_host() -> None:
    payload = firmware_ota_payload(
        "cores3-gateway",
        "https://homehub-firmware-int.s3.eu-west-1.amazonaws.com/"
        "gateways/cores3-gateway/controller.bin",
    )
    assert payload["command"] == "ota"
    assert payload["gatewayId"] == "cores3-gateway"
    assert payload["url"].startswith("https://")


def test_firmware_ota_payload_rejects_http() -> None:
    with pytest.raises(ValueError, match="https"):
        firmware_ota_payload("cores3-gateway", "http://example.com/controller.bin")


def test_firmware_ota_payload_rejects_non_s3_host() -> None:
    with pytest.raises(ValueError, match="not allowed"):
        firmware_ota_payload("cores3-gateway", "https://evil.example/controller.bin")


def test_compact_runtime_plan_keeps_only_gateway_fields() -> None:
    compact = compact_runtime_plan(
        {
            "id": "sample-home-a",
            "name": "Home A",
            "width": 800,
            "height": 600,
            "rooms": [
                {
                    "id": "living",
                    "name": "Living",
                    "x": 10,
                    "y": 20,
                    "w": 300,
                    "h": 200,
                    "editorOnly": True,
                }
            ],
            "sensors": [
                {
                    "id": "air",
                    "kind": "climate",
                    "label": "ALPSTUGA",
                    "x": 50,
                    "y": 60,
                    "deviceId": "matter-6",
                    "selected": True,
                }
            ],
            "walls": [{"x1": 0}],
        }
    )
    assert compact["version"] == 1
    assert compact["id"] == "sample-home-a"
    assert compact["name"] == "Home A"
    assert "editorOnly" not in compact["rooms"][0]
    assert "selected" not in compact["sensors"][0]
    assert "walls" not in compact


def test_compact_runtime_plan_rejects_oversize() -> None:
    with pytest.raises(ValueError, match="exceeds"):
        compact_runtime_plan(
            {
                "width": 800,
                "height": 600,
                "rooms": [],
                "sensors": [
                    {
                        "id": f"sensor-{index}",
                        "kind": "climate",
                        "label": "x" * 200,
                        "x": index,
                        "y": index,
                        "deviceId": f"matter-{index}",
                    }
                    for index in range(30)
                ],
            }
        )
