"""Tests for IoT Step Functions provisioning helpers."""

import json

from homehub_api.iot.sfn.common import (
    _unwrap_pipe_input,
    merge_provision_context,
    parse_stream_record,
    resolve_provision_context,
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
                "configuration": {"S": '{"reportingIntervalSeconds":10}'},
            },
        },
    }
    parsed = parse_stream_record(record)
    assert parsed is not None
    assert parsed["deviceId"] == "dev1"
    assert parsed["tenantPk"] == "HUB#demo"
    assert parsed["type"] == "environmental-sensor"
    assert parsed["runtimeKind"] == "simulated"
    assert parsed["ssmCertPrefix"] == "/homehub/devices/dev1"


def test_parse_stream_record_preserves_physical_runtime() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {
            "Keys": {"PK": {"S": "HUB#demo"}, "SK": {"S": "DEVICE#fb1"}},
            "NewImage": {
                "PK": {"S": "HUB#demo"},
                "SK": {"S": "DEVICE#fb1"},
                "deviceId": {"S": "fb1"},
                "type": {"S": "environmental-sensor"},
                "runtimeKind": {"S": "physical"},
                "lifecycleStatus": {"S": "PROVISIONING"},
            },
        },
    }
    parsed = parse_stream_record(record)
    assert parsed is not None
    assert parsed["runtimeKind"] == "physical"


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


def test_resolve_provision_context_from_step_output() -> None:
    context = resolve_provision_context(
        {
            "tenantPk": "HUB#demo",
            "deviceId": "dev-co",
            "type": "carbon-monoxide-alarm",
            "thingName": "homehub-dev-co",
        }
    )
    assert context["deviceId"] == "dev-co"
    assert context["type"] == "carbon-monoxide-alarm"


def test_resolve_provision_context_unwraps_lambda_payload() -> None:
    context = resolve_provision_context(
        {
            "StatusCode": 200,
            "Payload": json.dumps(
                {
                    "tenantPk": "HUB#demo",
                    "deviceId": "dev-co",
                    "certificateId": "cert-1",
                }
            ),
        }
    )
    assert context["deviceId"] == "dev-co"
    assert context["certificateId"] == "cert-1"


def test_resolve_provision_context_merges_nested_cert_and_thing_results() -> None:
    context = resolve_provision_context(
        {
            "tenantPk": "HUB#demo",
            "deviceId": "dev-co",
            "type": "carbon-monoxide-alarm",
            "cert": {
                "certificateArn": "arn:aws:iot:eu-west-1:123:cert/abc",
                "certificateId": "cert-1",
                "ssmCertPrefix": "/homehub/devices/dev-co",
            },
            "thing": {"thingName": "homehub-dev-co"},
        }
    )
    assert context["deviceId"] == "dev-co"
    assert context["certificateArn"] == "arn:aws:iot:eu-west-1:123:cert/abc"
    assert context["thingName"] == "homehub-dev-co"


def test_resolve_provision_context_infers_device_id_from_cert_prefix() -> None:
    context = resolve_provision_context(
        {
            "tenantPk": "HUB#demo",
            "certificateArn": "arn:aws:iot:eu-west-1:123:cert/abc",
            "ssmCertPrefix": "/homehub/devices/dev-co",
        }
    )
    assert context["deviceId"] == "dev-co"


def test_merge_provision_context_preserves_fields_across_tasks() -> None:
    merged = merge_provision_context(
        {"tenantPk": "HUB#demo", "deviceId": "dev-co", "type": "carbon-monoxide-alarm"},
        certificateId="cert-1",
        thingName="homehub-dev-co",
    )
    assert merged["deviceId"] == "dev-co"
    assert merged["certificateId"] == "cert-1"
    assert merged["thingName"] == "homehub-dev-co"


def test_resolve_provision_context_from_stream_record() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {
            "Keys": {"PK": {"S": "HUB#demo"}, "SK": {"S": "DEVICE#dev-co"}},
            "NewImage": {
                "PK": {"S": "HUB#demo"},
                "SK": {"S": "DEVICE#dev-co"},
                "deviceId": {"S": "dev-co"},
                "name": {"S": "Kitchen CO"},
                "type": {"S": "carbon-monoxide-alarm"},
                "lifecycleStatus": {"S": "PROVISIONING"},
                "configuration": {"S": '{"reportingIntervalSeconds":10,"thresholds":{"coAlarm":50}}'},
            },
        },
    }
    context = resolve_provision_context(record)
    assert context["deviceId"] == "dev-co"
    assert context["type"] == "carbon-monoxide-alarm"


def test_finalize_disables_registry_and_skips_sqs_for_physical(monkeypatch) -> None:
    from homehub_api.iot.sfn import finalize

    stored: dict[str, object] = {}

    class FakeTable:
        def put_item(self, Item):
            stored["registry"] = Item

        def update_item(self, **kwargs):
            stored["update"] = kwargs

    class FakeResource:
        def Table(self, _name):
            return FakeTable()

    class FakeSqs:
        def send_message(self, **kwargs):
            stored["sqs"] = kwargs

    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setenv("SIMULATOR_QUEUE_URL", "https://sqs.example/queue")
    monkeypatch.setattr(finalize.boto3, "resource", lambda _name: FakeResource())
    monkeypatch.setattr(finalize.boto3, "client", lambda _name: FakeSqs())

    result = finalize.handler(
        {
            "tenantPk": "HUB#demo",
            "deviceId": "fb1",
            "runtimeKind": "physical",
            "thingName": "homehub-fb1",
        },
        None,
    )
    assert result["lifecycleStatus"] == "READY"
    assert stored["registry"]["enabled"] is False
    assert stored["registry"]["runtimeKind"] == "physical"
    assert "sqs" not in stored
