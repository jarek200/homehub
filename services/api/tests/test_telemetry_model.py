from decimal import Decimal

from boto3.dynamodb.types import TypeSerializer

from homehub_api.telemetry_model import (
    derive_alarm_state,
    metrics_to_dynamo,
    normalize_telemetry_event,
)
from homehub_api.thresholds import parse_thresholds


def test_normalize_mini_model_payload() -> None:
    normalized = normalize_telemetry_event(
        {
            "alarm": False,
            "state": "normal",
            "metrics": {"temperature": 21.5, "humidity": 55},
        }
    )
    assert normalized["metrics"]["temperature"] == 21.5
    assert normalized["metrics"]["humidity"] == 55
    assert normalized["alarm"] is False


def test_derive_alarm_state_from_heat() -> None:
    alarm, state = derive_alarm_state({"heat": True})
    assert alarm is True
    assert state == "warning"


def test_derive_alarm_state_from_co() -> None:
    alarm, state = derive_alarm_state({"co": 55})
    assert alarm is True
    assert state == "warning"


def test_custom_humidity_threshold_moves_state_to_warning() -> None:
    configuration = '{"thresholds":{"humidityWarning":60}}'
    thresholds = parse_thresholds(configuration)
    normalized = normalize_telemetry_event(
        {"metrics": {"humidity": 62, "temperature": 20}},
        configuration=configuration,
    )
    assert normalized["state"] == "warning"
    assert normalized["alarm"] is False
    assert thresholds["humidityWarning"] == 60


def test_custom_temperature_threshold() -> None:
    configuration = '{"thresholds":{"temperatureWarning":24}}'
    normalized = normalize_telemetry_event(
        {"metrics": {"temperature": 25, "humidity": 50}},
        configuration=configuration,
    )
    assert normalized["state"] == "warning"


def test_voc_threshold_moves_state_to_warning() -> None:
    configuration = '{"thresholds":{"vocIndexWarning":150}}'
    normalized = normalize_telemetry_event(
        {"metrics": {"vocIndex": 180, "humidity": 50, "temperature": 22}},
        configuration=configuration,
        device_type="environmental-sensor",
    )
    assert normalized["state"] == "warning"


def test_payload_state_does_not_override_server_thresholds() -> None:
    normalized = normalize_telemetry_event(
        {
            "state": "normal",
            "metrics": {"humidity": 90, "temperature": 30, "vocIndex": 250},
        },
        device_type="environmental-sensor",
    )
    assert normalized["state"] == "warning"


def test_metrics_to_dynamo_serializes_for_dynamodb() -> None:
    metrics = metrics_to_dynamo({"temperature": 21.5, "humidity": 55, "heat": False})
    assert metrics["temperature"] == Decimal("21.5")
    assert metrics["humidity"] == Decimal("55")
    assert metrics["heat"] is False

    serializer = TypeSerializer()
    serialized = serializer.serialize(metrics)
    assert serialized["M"]["temperature"] == {"N": "21.5"}


def test_normalize_parses_metrics_json_string_from_iot_rule() -> None:
    normalized = normalize_telemetry_event(
        {
            "alarm": False,
            "state": "normal",
            "metrics": '{"leak": false, "batteryPercent": 82}',
        },
        device_type="leak-sensor",
    )
    assert normalized["metrics"]["leak"] is False
    assert normalized["metrics"]["batteryPercent"] == 82
