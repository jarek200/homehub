from homehub_api.thresholds import humidity_issue_threshold, parse_thresholds


def test_parse_thresholds_uses_defaults() -> None:
    thresholds = parse_thresholds(None)
    assert thresholds["humidityWarning"] == 70
    assert thresholds["temperatureWarning"] == 28
    assert thresholds["coAlarm"] == 50


def test_parse_thresholds_merges_configuration() -> None:
    thresholds = parse_thresholds('{"thresholds":{"humidityWarning":65}}')
    assert thresholds["humidityWarning"] == 65
    assert thresholds["coAlarm"] == 50


def test_humidity_issue_threshold_from_configuration() -> None:
    assert humidity_issue_threshold('{"thresholds":{"humidityWarning":68}}') == 68
