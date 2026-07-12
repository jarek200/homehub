"""Tests for IoT Step Functions provisioning helpers."""

from homehub_api.iot.sfn.common import (
    _unwrap_pipe_input,
    parse_stream_record,
    ssm_prefix_for,
    thing_name_for,
)


def test_thing_name_for_prefixes_device_id() -> None:
    assert thing_name_for("abc123") == "homehub-abc123"


def test_ssm_prefix_for_device() -> None:
    assert ssm_prefix_for("abc123") == "/homehub/devices/abc123"


def test_unwrap_pipe_input_accepts_eventbridge_pipe_array() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {"Keys": {"SK": {"S": "DEVICE#dev1"}}},
    }
    assert _unwrap_pipe_input([record]) == record


def test_unwrap_pipe_input_accepts_lambda_records_wrapper() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {"Keys": {"SK": {"S": "DEVICE#dev1"}}},
    }
    assert _unwrap_pipe_input({"Records": [record]}) == record


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
    assert parsed["tenantPk"] == "HUB#demo"
    assert parsed["type"] == "environmental-sensor"
    assert parsed["ssmCertPrefix"] == "/homehub/devices/dev1"


def test_parse_stream_record_preserves_user_hub() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {
            "Keys": {"PK": {"S": "HUB#user-abc"}, "SK": {"S": "DEVICE#dev2"}},
            "NewImage": {
                "PK": {"S": "HUB#user-abc"},
                "SK": {"S": "DEVICE#dev2"},
                "deviceId": {"S": "dev2"},
                "lifecycleStatus": {"S": "PROVISIONING"},
            },
        },
    }
    parsed = parse_stream_record(record)
    assert parsed is not None
    assert parsed["tenantPk"] == "HUB#user-abc"


def test_parse_stream_record_ignores_ready_devices() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {
            "Keys": {"SK": {"S": "DEVICE#dev1"}},
            "NewImage": {"lifecycleStatus": {"S": "READY"}},
        },
    }
    assert parse_stream_record(record) is None
