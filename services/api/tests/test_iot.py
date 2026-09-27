"""Tests for IoT Step Functions provisioning helpers."""

import json

from homehub_api.iot.sfn.common import (
    parse_stream_record,
    resolve_provision_context,
    shadow_desired,
    shadow_update_payload,
    ssm_prefix_for,
    thing_name_for,
)


def test_thing_name_for_prefixes_device_id() -> None:
    assert thing_name_for("abc123") == "homehub-abc123"


def test_ssm_prefix_for_device() -> None:
    assert ssm_prefix_for("abc123") == "/homehub/devices/abc123"


def test_parse_stream_record_filters_provisioning_inserts() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {
            "Keys": {"PK": {"S": "HOUSEHOLD#demo"}, "SK": {"S": "DEVICE#dev1"}},
            "NewImage": {
                "PK": {"S": "HOUSEHOLD#demo"},
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
    assert parsed["tenantPk"] == "HOUSEHOLD#demo"
    assert parsed["type"] == "environmental-sensor"
    assert parsed["runtimeKind"] == "physical"
    assert parsed["ssmCertPrefix"] == "/homehub/devices/dev1"


def test_parse_stream_record_preserves_physical_runtime() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {
            "Keys": {"PK": {"S": "HOUSEHOLD#demo"}, "SK": {"S": "DEVICE#fb1"}},
            "NewImage": {
                "PK": {"S": "HOUSEHOLD#demo"},
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
            "Keys": {"PK": {"S": "HOUSEHOLD#user-abc"}, "SK": {"S": "DEVICE#dev2"}},
            "NewImage": {
                "PK": {"S": "HOUSEHOLD#user-abc"},
                "SK": {"S": "DEVICE#dev2"},
                "deviceId": {"S": "dev2"},
                "lifecycleStatus": {"S": "PROVISIONING"},
            },
        },
    }
    parsed = parse_stream_record(record)
    assert parsed is not None
    assert parsed["tenantPk"] == "HOUSEHOLD#user-abc"


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
            "tenantPk": "HOUSEHOLD#demo",
            "deviceId": "dev-co",
            "type": "camera",
            "thingName": "homehub-dev-co",
        }
    )
    assert context["deviceId"] == "dev-co"
    assert context["type"] == "camera"


def test_resolve_provision_context_unwraps_lambda_payload() -> None:
    context = resolve_provision_context(
        {
            "StatusCode": 200,
            "Payload": json.dumps(
                {
                    "tenantPk": "HOUSEHOLD#demo",
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
            "tenantPk": "HOUSEHOLD#demo",
            "deviceId": "dev-co",
            "type": "camera",
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
            "tenantPk": "HOUSEHOLD#demo",
            "certificateArn": "arn:aws:iot:eu-west-1:123:cert/abc",
            "ssmCertPrefix": "/homehub/devices/dev-co",
        }
    )
    assert context["deviceId"] == "dev-co"


def test_resolve_provision_context_from_stream_record() -> None:
    record = {
        "eventName": "INSERT",
        "dynamodb": {
            "Keys": {"PK": {"S": "HOUSEHOLD#demo"}, "SK": {"S": "DEVICE#dev-co"}},
            "NewImage": {
                "PK": {"S": "HOUSEHOLD#demo"},
                "SK": {"S": "DEVICE#dev-co"},
                "deviceId": {"S": "dev-co"},
                "name": {"S": "Kitchen CO"},
                "type": {"S": "camera"},
                "lifecycleStatus": {"S": "PROVISIONING"},
                "configuration": {
                    "S": '{"reportingIntervalSeconds":10,"thresholds":{"coAlarm":50}}'
                },
            },
        },
    }
    context = resolve_provision_context(record)
    assert context["deviceId"] == "dev-co"
    assert context["type"] == "camera"


def test_shadow_update_payload_matches_sfn_envelope() -> None:
    assert shadow_update_payload(None, "camera") == {"state": {"desired": {"type": "camera"}}}
    assert shadow_update_payload("", "camera") == {"state": {"desired": {"type": "camera"}}}
    assert shadow_update_payload("{}", "environmental-sensor") == {
        "state": {"desired": {"type": "environmental-sensor"}}
    }
    assert shadow_update_payload("not-json", "camera") == {"state": {"desired": {"type": "camera"}}}
    assert shadow_update_payload('{"reportingIntervalSeconds":10}', "camera") == {
        "state": {
            "desired": {
                "type": "camera",
                "configuration": {"reportingIntervalSeconds": 10},
            }
        }
    }
    assert shadow_desired("{}", "camera") == {"type": "camera"}
    assert "configuration" not in shadow_desired(None, "camera")


def test_create_cert_attaches_camera_policy_only_for_cameras(monkeypatch) -> None:
    from homehub_api.iot.sfn import create_cert

    attached: list[str] = []
    shadows: list[tuple[str, dict]] = []

    class FakeIot:
        def create_keys_and_certificate(self, setAsActive=True):
            return {
                "certificateArn": "arn:aws:iot:eu-west-1:1:cert/abc",
                "certificateId": "cert-1",
                "certificatePem": "CERT",
                "keyPair": {"PrivateKey": "KEY"},
            }

        def attach_policy(self, policyName, target):
            attached.append(policyName)
            assert target == "arn:aws:iot:eu-west-1:1:cert/abc"

    class FakeSsm:
        def put_parameter(self, **kwargs):
            return {}

    class FakeIotData:
        def update_thing_shadow(self, thingName, payload):
            shadows.append((thingName, json.loads(payload)))

    def fake_client(name: str, **kwargs):
        if name == "iot":
            return FakeIot()
        if name == "ssm":
            return FakeSsm()
        if name == "iot-data":
            assert kwargs.get("endpoint_url") == "https://iot.example.com"
            return FakeIotData()
        raise AssertionError(name)

    monkeypatch.setenv("IOT_POLICY_NAME", "homehub-int-device")
    monkeypatch.setenv("CAMERA_IOT_POLICY_NAME", "homehub-int-camera")
    monkeypatch.setenv("AMAZON_ROOT_CA_PEM", "CA")
    monkeypatch.setenv("IOT_DATA_ENDPOINT", "https://iot.example.com")
    monkeypatch.setattr(create_cert.boto3, "client", fake_client)

    create_cert.handler(
        {
            "tenantPk": "HOUSEHOLD#demo",
            "deviceId": "cam-1",
            "type": "camera",
            "ssmCertPrefix": "/homehub/devices/cam-1",
            "configuration": '{"reportingIntervalSeconds":10}',
        },
        None,
    )
    assert attached == ["homehub-int-camera"]
    assert shadows == [
        (
            "homehub-cam-1",
            {
                "state": {
                    "desired": {
                        "type": "camera",
                        "configuration": {"reportingIntervalSeconds": 10},
                    }
                }
            },
        )
    ]

    attached.clear()
    shadows.clear()
    create_cert.handler(
        {
            "tenantPk": "HOUSEHOLD#demo",
            "deviceId": "env-1",
            "type": "environmental-sensor",
            "ssmCertPrefix": "/homehub/devices/env-1",
        },
        None,
    )
    assert attached == ["homehub-int-device"]
    assert shadows == [("homehub-env-1", {"state": {"desired": {"type": "environmental-sensor"}}})]
