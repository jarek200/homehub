from datetime import UTC, datetime

import pytest

from homehub_api.errors import ApiError
from homehub_api.iot.snapshots import (
    recorded_at_from_key,
    sample_evenly,
    snapshot_start_after,
    validate_snapshot_window,
)


def test_recorded_at_from_key_parses_camera_stamp() -> None:
    recorded = recorded_at_from_key("snapshots/cam-1/2026-08-16T120000Z.jpg", "cam-1")
    assert recorded == datetime(2026, 8, 16, 12, 0, tzinfo=UTC)


def test_recorded_at_from_key_parses_fractional_stamp() -> None:
    recorded = recorded_at_from_key("snapshots/cam-1/2026-08-16T120000.250Z.jpg", "cam-1")
    assert recorded == datetime(2026, 8, 16, 12, 0, 0, 250000, tzinfo=UTC)


def test_recorded_at_from_key_rejects_other_device() -> None:
    assert recorded_at_from_key("snapshots/other/2026-08-16T120000Z.jpg", "cam-1") is None


def test_snapshot_start_after_includes_exact_start() -> None:
    start = datetime(2026, 8, 16, 10, 0, tzinfo=UTC)
    assert snapshot_start_after("cam-1", start) == "snapshots/cam-1/2026-08-16T100000"


def test_sample_evenly_keeps_newest_and_oldest() -> None:
    items = list(range(50))
    sampled = sample_evenly(items, 24)
    assert len(sampled) == 24
    assert sampled[0] == 0
    assert sampled[-1] == 49


def test_sample_evenly_returns_all_when_under_limit() -> None:
    assert sample_evenly([1, 2, 3], 24) == [1, 2, 3]


def test_validate_snapshot_window_rejects_inverted_range() -> None:
    start = datetime(2026, 8, 16, 2, tzinfo=UTC)
    end = datetime(2026, 8, 16, 1, tzinfo=UTC)
    with pytest.raises(ApiError) as exc:
        validate_snapshot_window(start=start, end=end)
    assert exc.value.status_code == 400
