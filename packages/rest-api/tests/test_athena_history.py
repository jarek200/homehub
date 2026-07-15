from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from homehub_api.errors import ApiError
from homehub_api.iot.athena_history import (
    build_history_sql,
    partition_days,
    query_device_history,
    row_to_reading,
)


def test_partition_days_covers_midnight_boundary() -> None:
    now = datetime(2026, 7, 15, 1, 30, tzinfo=UTC)
    days = partition_days(3, now=now)
    assert days == [("2026", "07", "14"), ("2026", "07", "15")]


def test_build_history_sql_includes_hub_device_and_cutoff() -> None:
    now = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)
    sql = build_history_sql(
        database="homehub_int_telemetry",
        table="device_telemetry",
        hub_id="user-1",
        device_id="dev-1",
        hours=3,
        now=now,
    )
    assert "hub = 'user-1'" in sql
    assert "deviceid = 'dev-1'" in sql
    assert "year = '2026' AND month = '07' AND day = '15'" in sql
    assert "TRY(CAST(recordedat AS bigint)) >=" in sql


def test_build_history_sql_rejects_unsafe_ids() -> None:
    with pytest.raises(ApiError):
        build_history_sql(
            database="homehub_int_telemetry",
            table="device_telemetry",
            hub_id="bad';drop",
            device_id="dev-1",
            hours=3,
        )


def test_row_to_reading_parses_epoch_and_metrics() -> None:
    reading = row_to_reading(
        {
            "deviceid": "dev-1",
            "recordedat": "1721052000000",
            "alarm": "false",
            "state": "normal",
            "metrics": '{"co": 8.2, "heat": false}',
        },
        device_id="dev-1",
    )
    assert reading.device_id == "dev-1"
    assert reading.metrics["co"] == 8.2
    assert reading.metrics["heat"] is False
    assert reading.recorded_at.startswith("2024-")


def test_query_device_history_maps_athena_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ATHENA_DATABASE", "homehub_int_telemetry")
    monkeypatch.setenv("ATHENA_TABLE", "device_telemetry")
    monkeypatch.setenv("ATHENA_OUTPUT", "s3://bucket/results/")

    client = MagicMock()
    client.start_query_execution.return_value = {"QueryExecutionId": "q1"}
    client.get_query_execution.return_value = {
        "QueryExecution": {"Status": {"State": "SUCCEEDED"}}
    }
    client.get_query_results.return_value = {
        "ResultSet": {
            "Rows": [
                {
                    "Data": [
                        {"VarCharValue": "deviceid"},
                        {"VarCharValue": "recordedat"},
                        {"VarCharValue": "alarm"},
                        {"VarCharValue": "state"},
                        {"VarCharValue": "metrics"},
                    ]
                },
                {
                    "Data": [
                        {"VarCharValue": "dev-1"},
                        {"VarCharValue": "1721052000000"},
                        {"VarCharValue": "false"},
                        {"VarCharValue": "normal"},
                        {"VarCharValue": '{"co": 4.5}'},
                    ]
                },
            ]
        }
    }

    items = query_device_history(hub_id="user-1", device_id="dev-1", hours=3, client=client)
    assert len(items) == 1
    assert items[0].metrics["co"] == 4.5
    client.start_query_execution.assert_called_once()
