"""Tests for IoT Step Functions provisioning helpers."""

from homehub_api.iot.sfn.common import parse_stream_record, ssm_prefix_for, thing_name_for


def test_thing_name_for_prefixes_device_id() -> None:
    assert thing_name_for("abc123") == "homehub-abc123"


def test_ssm_prefix_for_device() -> None:
    assert ssm_prefix_for("abc123") == "/homehub/devices/abc123"


def test_parse_stream_record_filters_provisioning_inserts() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {
            "Keys": {"PK": {"S": "HUB#demo"}, "SK": {"S": "DEVICE#dev1"}},
            "NewImage": {
                "PK": {"S": "HUB#demo"},
                "SK": {"S": "DEVICE#dev1"},
                "deviceId": {"S": "dev1"},
                "name": {"S": "Hallway"},
                "type": {"S": "environmental-sensor"},
                "lifecycleStatus": {"S": "PROVISIONING"},
                "configuration": {"S": '{"model":"Ei1020"}'},
            },
        },
    }
    parsed = parse_stream_record(record)
    assert parsed is not None
    assert parsed["deviceId"] == "dev1"
    assert parsed["type"] == "environmental-sensor"
    assert parsed["ssmCertPrefix"] == "/homehub/devices/dev1"


def test_parse_stream_record_ignores_ready_devices() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {
            "Keys": {"SK": {"S": "DEVICE#dev1"}},
            "NewImage": {"lifecycleStatus": {"S": "READY"}},
        },
    }
    assert parse_stream_record(record) is None
