from homehub_api.device_configuration import CAMERA_DEFAULT_CONFIGURATION, configuration_for_create


def test_configuration_for_create_camera_defaults() -> None:
    encoded = configuration_for_create("camera", None)
    assert encoded is not None
    assert '"pan": 90' in encoded
    assert '"tilt": 90' in encoded
    assert '"reportingIntervalSeconds": 30' in encoded


def test_configuration_for_create_camera_keeps_overrides() -> None:
    encoded = configuration_for_create("camera", {"pan": 30, "tilt": 120})
    assert encoded is not None
    assert '"pan": 30' in encoded
    assert '"tilt": 120' in encoded
    assert '"reportingIntervalSeconds": 30' in encoded


def test_configuration_for_create_sensor_unchanged() -> None:
    assert configuration_for_create("heat-alarm", None) is None
    encoded = configuration_for_create("heat-alarm", {"reportingIntervalSeconds": 10})
    assert encoded is not None
    assert "pan" not in encoded


def test_camera_defaults_table() -> None:
    assert CAMERA_DEFAULT_CONFIGURATION["pan"] == 90
    assert CAMERA_DEFAULT_CONFIGURATION["tilt"] == 90
