from decimal import Decimal

from boto3.dynamodb.types import TypeSerializer

from homehub_api.telemetry_model import (
    derive_alarm_state,
    metrics_to_dynamo,
    normalize_telemetry_event,
    sample_metrics,
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


def test_humidity_sensor_sample_metrics() -> None:
    metrics = sample_metrics("humidity-sensor")
    assert "humidity" in metrics
    assert isinstance(metrics["humidity"], float)


def test_environmental_sensor_alias_sample_metrics() -> None:
    metrics = sample_metrics("environmental-sensor")
    assert "humidity" in metrics


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
            "metrics": '{"co": 8.2, "heat": false}',
        },
        device_type="carbon-monoxide-alarm",
    )
    assert normalized["metrics"]["co"] == 8.2
    assert normalized["metrics"]["heat"] is False


def test_normalize_maps_legacy_temperature_to_co_for_co_alarm() -> None:
    normalized = normalize_telemetry_event(
        {"metrics": {"temperature": 12.5, "heat": False}},
        device_type="carbon-monoxide-alarm",
    )
    assert normalized["metrics"]["co"] == 12.5
