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


def test_configuration_for_create_environmental_defaults() -> None:
    encoded = configuration_for_create("environmental-sensor", None, runtime_kind="physical")
    assert encoded is not None
    assert '"reportingIntervalSeconds": 300' in encoded
    assert '"powerMode": "low-power-voc"' in encoded
    assert '"vocIndexWarning": 200.0' in encoded


def test_configuration_for_create_environmental_clamps_physical_interval() -> None:
    encoded = configuration_for_create(
        "environmental-sensor",
        {"reportingIntervalSeconds": 15},
        runtime_kind="physical",
    )
    assert encoded is not None
    assert '"reportingIntervalSeconds": 60' in encoded


def test_camera_defaults_table() -> None:
    assert CAMERA_DEFAULT_CONFIGURATION["pan"] == 90
    assert CAMERA_DEFAULT_CONFIGURATION["tilt"] == 90


def test_normalize_camera_configuration_defaults() -> None:
    from homehub_api.device_configuration import _normalize_camera_configuration

    merged = _normalize_camera_configuration({})
    assert merged["frameSize"] == "qvga"
    assert merged["jpegQuality"] == 12
    assert merged["vflip"] is True


def test_normalize_camera_configuration_clamps_reporting() -> None:
    from homehub_api.device_configuration import _normalize_camera_configuration

    merged = _normalize_camera_configuration({"reportingIntervalSeconds": 5, "frameSize": "vga"})
    assert merged["reportingIntervalSeconds"] == 15
    assert merged["frameSize"] == "vga"


def test_normalize_configuration_update_merges_camera() -> None:
    from homehub_api.device_configuration import normalize_configuration_update

    encoded = normalize_configuration_update(
        "camera",
        "physical",
        {"frameSize": "qvga", "jpegQuality": 12},
        {"jpegQuality": 20, "frameSize": "vga"},
    )
    assert encoded is not None
    assert '"jpegQuality": 20' in encoded
    assert '"frameSize": "vga"' in encoded
