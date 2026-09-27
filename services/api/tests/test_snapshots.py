from datetime import UTC, datetime

import pytest

from homehub_api.errors import ApiError
from homehub_api.iot.snapshots import (
    list_indexed_snapshots,
    recorded_at_from_key,
    sample_evenly,
    snapshot_start_after,
    validate_snapshot_window,
)


def test_recorded_at_from_key_parses_camera_stamp() -> None:
    recorded = recorded_at_from_key("snapshots/cam-1/2026-08-16T120000Z.jpg", "cam-1")
    assert recorded == datetime(2026, 8, 16, 12, 0, tzinfo=UTC)
    recorded_household = recorded_at_from_key(
        "snapshots/family-1/cam-1/2026-08-16T120000Z.jpg", "cam-1", "family-1"
    )
    assert recorded_household == datetime(2026, 8, 16, 12, 0, tzinfo=UTC)


def test_recorded_at_from_key_parses_fractional_stamp() -> None:
    recorded = recorded_at_from_key("snapshots/cam-1/2026-08-16T120000.250Z.jpg", "cam-1")
    assert recorded == datetime(2026, 8, 16, 12, 0, 0, 250000, tzinfo=UTC)


def test_recorded_at_from_key_rejects_other_device() -> None:
    assert recorded_at_from_key("snapshots/other/2026-08-16T120000Z.jpg", "cam-1") is None


def test_recorded_at_from_key_parses_thing_name_prefix() -> None:
    recorded = recorded_at_from_key("snapshots/homehub-cam-1/2026-09-17T230001.996Z.jpg", "cam-1")
    assert recorded == datetime(2026, 9, 17, 23, 0, 1, 996000, tzinfo=UTC)


def test_snapshot_start_after_includes_exact_start() -> None:
    start = datetime(2026, 8, 16, 10, 0, tzinfo=UTC)
    assert snapshot_start_after("cam-1", start) == "snapshots/cam-1/2026-08-16T100000"
    assert (
        snapshot_start_after("cam-1", start, "family-1")
        == "snapshots/family-1/cam-1/2026-08-16T100000"
    )


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


def test_list_indexed_snapshots_reads_only_one_bounded_page(monkeypatch) -> None:
    class Table:
        def query(self, **kwargs):
            assert kwargs["Limit"] == 25
            assert kwargs["ScanIndexForward"] is False
            return {
                "Items": [
                    {
                        "snapshotKey": "snapshots/homehub-cam-1/new.jpg",
                        "recordedAt": "2026-08-16T12:00:00.250Z",
                    }
                ]
            }

    class Resource:
        def Table(self, _name):  # noqa: N802
            return Table()

    monkeypatch.setenv("TABLE_NAME", "test-table")
    monkeypatch.setattr("homehub_api.iot.snapshots.boto3.resource", lambda _service: Resource())
    found, truncated = list_indexed_snapshots(
        device_id="cam-1",
        household_id="family-1",
        start=datetime(2026, 8, 16, 10, tzinfo=UTC),
        end=datetime(2026, 8, 16, 13, tzinfo=UTC),
    )
    assert found == [
        (
            "snapshots/homehub-cam-1/new.jpg",
            datetime(2026, 8, 16, 12, 0, 0, 250000, tzinfo=UTC),
        )
    ]
    assert truncated is False
