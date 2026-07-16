import json
import os
from unittest.mock import MagicMock, patch

from homehub_api.iot.shadow import (
    apply_shadow_state,
    merge_configuration,
    push_device_shadow_desired,
)


def test_merge_configuration_deep_merges_thresholds() -> None:
    base = {
        "reportingIntervalSeconds": 10,
        "thresholds": {"humidityWarning": 70, "temperatureWarning": 28},
    }
    patch = {"thresholds": {"humidityWarning": 65}}

    merged = merge_configuration(base, patch)

    assert merged["reportingIntervalSeconds"] == 10
    assert merged["thresholds"]["humidityWarning"] == 65
    assert merged["thresholds"]["temperatureWarning"] == 28


def test_apply_shadow_state_updates_configuration_json() -> None:
    current = json.dumps(
        {
            "reportingIntervalSeconds": 10,
            "thresholds": {"humidityWarning": 70},
        }
    )

    configuration, reported = apply_shadow_state(
        configuration=current,
        device_type="environmental-sensor",
        state={"configuration": {"thresholds": {"humidityWarning": 62}}},
    )

    assert configuration is not None
    parsed = json.loads(configuration)
    assert parsed["thresholds"]["humidityWarning"] == 62
    assert reported["configuration"]["thresholds"]["humidityWarning"] == 62
    assert reported["type"] == "environmental-sensor"


@patch.dict(os.environ, {"IOT_DATA_ENDPOINT": "https://iot.example.com"})
@patch("homehub_api.iot.shadow.boto3.client")
def test_push_device_shadow_desired_updates_shadow(mock_boto_client: MagicMock) -> None:
    iot_data = MagicMock()
    mock_boto_client.return_value = iot_data

    push_device_shadow_desired(
        device_id="dev1",
        device_type="heat-alarm",
        configuration='{"thresholds":{"temperatureWarning":30}}',
        thing_name="homehub-dev1",
    )

    mock_boto_client.assert_called_once_with("iot-data", endpoint_url="https://iot.example.com")
    iot_data.update_thing_shadow.assert_called_once()
    call = iot_data.update_thing_shadow.call_args.kwargs
    assert call["thingName"] == "homehub-dev1"
    payload = json.loads(call["payload"].decode())
    assert payload["state"]["desired"]["type"] == "heat-alarm"
    assert payload["state"]["desired"]["configuration"]["thresholds"]["temperatureWarning"] == 30

