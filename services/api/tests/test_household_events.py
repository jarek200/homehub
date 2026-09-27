from homehub_api.household_events import (
    build_camera_snapshot_event,
    build_device_updated_event,
    build_household_state_event,
    channel_for_hub_pk,
    is_hub_state_record,
    sanitize_household_state,
    tenant_pk_from_record,
)
from homehub_api.iot.household_events import (
    household_event_from_record,
    source_to_publish_latency_ms,
    unmarshal_image,
)


def test_channel_for_hub_pk() -> None:
    assert channel_for_hub_pk("HOUSEHOLD#user-abc") == "household/user-abc"
    assert channel_for_hub_pk("HUB#user-abc") == "household/user-abc"
    assert channel_for_hub_pk("USER#abc") is None


def test_is_hub_state_record() -> None:
    assert is_hub_state_record(
        {"dynamodb": {"Keys": {"SK": {"S": "HUB_STATE"}, "PK": {"S": "HUB#user-1"}}}}
    )
    assert not is_hub_state_record({"dynamodb": {"Keys": {"SK": {"S": "FLOOR_PLAN"}}}})


def test_sanitize_household_state_strips_secrets() -> None:
    cleaned = sanitize_household_state(
        {
            "lights": [{"id": "matter-1", "on": True, "setupCode": "1111"}],
            "cameraUrl": "https://cam.example/live",
            "token": "secret",
            "scene": "home",
            "updatedAt": "2026-09-17T12:00:00Z",
            "stateVersion": 3,
        }
    )
    assert "cameraUrl" not in cleaned
    assert "token" not in cleaned
    assert cleaned["lights"][0]["id"] == "matter-1"
    assert "setupCode" not in cleaned["lights"][0]


def test_sanitize_household_state_keeps_sensor_history() -> None:
    cleaned = sanitize_household_state(
        {
            "scene": "home",
            "sensorHistory": {
                "matter-5": {
                    "kind": "contact",
                    "events": [{"kind": "contact", "at": "2026-09-18T16:08:56Z", "value": "OPEN"}],
                },
                "matter-1": {"kind": "light", "events": []},
            },
        }
    )
    assert cleaned["sensorHistory"]["matter-5"]["events"][0]["value"] == "OPEN"
    assert "matter-1" not in cleaned["sensorHistory"]


def test_build_household_state_event() -> None:
    event = build_household_state_event(
        event_id="evt-1",
        state={"scene": "away", "updatedAt": "2026-09-17T12:00:00Z", "stateVersion": 9},
    )
    assert event["type"] == "household.state.v1"
    assert event["eventId"] == "evt-1"
    assert event["stateVersion"] == 9
    assert event["state"]["scene"] == "away"


def test_build_camera_snapshot_event() -> None:
    event = build_camera_snapshot_event(
        event_id="cam-1:2026-09-21T00:00:00Z",
        device_id="cam-1",
        recorded_at="2026-09-21T00:00:00Z",
    )
    assert event == {
        "type": "camera.snapshot.v1",
        "eventId": "cam-1:2026-09-21T00:00:00Z",
        "deviceId": "cam-1",
        "recordedAt": "2026-09-21T00:00:00Z",
    }


def test_build_device_updated_event() -> None:
    event = build_device_updated_event(
        event_id="cam-1:updated:2026-09-21T00:00:00Z",
        device_id="cam-1",
        recorded_at="2026-09-21T00:00:00Z",
        status="ONLINE",
        occupied=True,
    )
    assert event == {
        "type": "device.updated.v1",
        "eventId": "cam-1:updated:2026-09-21T00:00:00Z",
        "deviceId": "cam-1",
        "recordedAt": "2026-09-21T00:00:00Z",
        "status": "ONLINE",
        "occupied": True,
    }


def test_unmarshal_and_filter_stream_record() -> None:
    record = {
        "eventID": "abc",
        "eventName": "MODIFY",
        "dynamodb": {
            "Keys": {"PK": {"S": "HUB#user-1"}, "SK": {"S": "HUB_STATE"}},
            "NewImage": {
                "PK": {"S": "HUB#user-1"},
                "SK": {"S": "HUB_STATE"},
                "updatedAt": {"S": "2026-09-17T12:00:00Z"},
                "state": {
                    "M": {
                        "scene": {"S": "home"},
                        "updatedAt": {"S": "2026-09-17T12:00:00Z"},
                        "stateVersion": {"N": "4"},
                        "lights": {"L": []},
                        "cameraUrl": {"S": "https://cam.example"},
                    }
                },
            },
        },
    }
    assert tenant_pk_from_record(record) == "HUB#user-1"
    parsed = household_event_from_record(record)
    assert parsed is not None
    channel, payload = parsed
    assert channel == "household/user-1"
    assert payload["stateVersion"] == 4
    assert "cameraUrl" not in payload["state"]

    ignored = dict(record)
    ignored["dynamodb"] = {
        **record["dynamodb"],
        "Keys": {"PK": {"S": "HUB#user-1"}, "SK": {"S": "FLOOR_PLAN"}},
    }
    assert household_event_from_record(ignored) is None


def test_unmarshal_image_converts_decimals() -> None:
    item = unmarshal_image({"width": {"N": "800.5"}, "name": {"S": "Kitchen"}})
    assert item["width"] == 800.5
    assert item["name"] == "Kitchen"


def test_source_to_publish_latency_uses_event_timestamp() -> None:
    assert source_to_publish_latency_ms({"updatedAt": "2026-09-17T12:00:00Z"}) > 0
    assert source_to_publish_latency_ms({"updatedAt": "not-a-date"}) == 0
    assert source_to_publish_latency_ms({}) == 0
