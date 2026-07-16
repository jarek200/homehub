"""Athena history queries over the S3 Parquet telemetry lake."""

from __future__ import annotations

import json
import os
import re
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import boto3

from homehub_api.errors import ApiError
from homehub_api.models import ReadingResponse
from homehub_api.observability import logger

_SAFE_ID = re.compile(r"^[A-Za-z0-9._:-]+$")
_POLL_SECONDS = 0.4
_MAX_WAIT_SECONDS = 20


def athena_configured() -> bool:
    return bool(
        os.environ.get("ATHENA_DATABASE", "").strip()
        and os.environ.get("ATHENA_TABLE", "").strip()
        and os.environ.get("ATHENA_OUTPUT", "").strip()
    )


def _require_safe_id(value: str, label: str) -> str:
    if not value or not _SAFE_ID.match(value):
        raise ApiError(f"Invalid {label}", 400, "ValidationError")
    return value


def partition_days(hours: int, *, now: datetime | None = None) -> list[tuple[str, str, str]]:
    """Return (year, month, day) partition tuples covering the lookback window."""
    end = now or datetime.now(UTC)
    start = end - timedelta(hours=hours)
    days: list[tuple[str, str, str]] = []
    cursor = datetime(start.year, start.month, start.day, tzinfo=UTC)
    last = datetime(end.year, end.month, end.day, tzinfo=UTC)
    while cursor <= last:
        days.append((f"{cursor.year:04d}", f"{cursor.month:02d}", f"{cursor.day:02d}"))
        cursor += timedelta(days=1)
    return days


def build_history_sql(
    *,
    database: str,
    table: str,
    hub_id: str,
    device_id: str,
    hours: int,
    now: datetime | None = None,
) -> str:
    hub_id = _require_safe_id(hub_id, "hub id")
    device_id = _require_safe_id(device_id, "device id")
    database = _require_safe_id(database, "database")
    table = _require_safe_id(table, "table")
    if hours < 1 or hours > 72:
        raise ApiError("hours must be between 1 and 72", 400, "ValidationError")

    end = now or datetime.now(UTC)
    cutoff_ms = int((end - timedelta(hours=hours)).timestamp() * 1000)
    day_clauses = []
    for year, month, day in partition_days(hours, now=end):
        day_clauses.append(f"(year = '{year}' AND month = '{month}' AND day = '{day}')")
    partitions = " OR ".join(day_clauses)

    # Cold-path recordedat is IoT timestamp() epoch millis (string in Parquet).
    return f"""
SELECT deviceid, hubid, thingname, alarm, state, metrics, recordedat
FROM {database}.{table}
WHERE hub = '{hub_id}'
  AND deviceid = '{device_id}'
  AND ({partitions})
  AND TRY(CAST(recordedat AS bigint)) >= {cutoff_ms}
ORDER BY TRY(CAST(recordedat AS bigint)) ASC
LIMIT 2000
""".strip()


def _metrics_from_cell(raw: Any) -> dict[str, float | bool]:
    if raw is None or raw == "":
        return {}
    if isinstance(raw, dict):
        parsed = raw
    else:
        try:
            parsed = json.loads(str(raw))
        except (json.JSONDecodeError, TypeError):
            return {}
    if not isinstance(parsed, dict):
        return {}
    metrics: dict[str, float | bool] = {}
    for key, value in parsed.items():
        if isinstance(value, bool):
            metrics[str(key)] = value
        elif isinstance(value, (int, float)):
            metrics[str(key)] = float(value)
        elif isinstance(value, str):
            lower = value.lower()
            if lower in ("true", "false"):
                metrics[str(key)] = lower == "true"
            else:
                try:
                    metrics[str(key)] = float(value)
                except ValueError:
                    continue
    return metrics


def _recorded_at_iso(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return datetime.now(UTC).isoformat().replace("+00:00", "Z")
    if text.isdigit():
        millis = int(text)
        # IoT timestamp() is millis; tolerate seconds.
        if millis < 10_000_000_000:
            millis *= 1000
        return datetime.fromtimestamp(millis / 1000, tz=UTC).isoformat().replace("+00:00", "Z")
    return text


def row_to_reading(row: dict[str, Any], *, device_id: str) -> ReadingResponse:
    recorded_at = _recorded_at_iso(row.get("recordedat"))
    reading_id = f"athena-{recorded_at}-{uuid4().hex[:8]}"
    alarm_raw = row.get("alarm")
    alarm = alarm_raw is True or str(alarm_raw).lower() == "true"
    state_raw = str(row.get("state") or ("warning" if alarm else "normal")).lower()
    state = "warning" if state_raw == "warning" else "normal"
    return ReadingResponse(
        readingId=reading_id,
        deviceId=str(row.get("deviceid") or device_id),
        alarm=alarm,
        state=state,
        metrics=_metrics_from_cell(row.get("metrics")),
        recordedAt=recorded_at,
        createdAt=recorded_at,
    )


def _result_rows(result: dict[str, Any]) -> list[dict[str, Any]]:
    result_set = result.get("ResultSet") or {}
    rows = result_set.get("Rows") or []
    if len(rows) < 2:
        return []
    headers = [col.get("VarCharValue", "") for col in rows[0].get("Data", [])]
    mapped: list[dict[str, Any]] = []
    for row in rows[1:]:
        cells = row.get("Data", [])
        item: dict[str, Any] = {}
        for index, header in enumerate(headers):
            if not header:
                continue
            cell = cells[index] if index < len(cells) else {}
            item[header.lower()] = cell.get("VarCharValue")
        mapped.append(item)
    return mapped


def query_device_history(
    *,
    hub_id: str,
    device_id: str,
    hours: int = 3,
    client: Any | None = None,
) -> list[ReadingResponse]:
    if not athena_configured():
        raise ApiError("Athena history is not configured", 503, "ServiceUnavailable")

    database = os.environ["ATHENA_DATABASE"].strip()
    table = os.environ["ATHENA_TABLE"].strip()
    output = os.environ["ATHENA_OUTPUT"].strip()
    workgroup = os.environ.get("ATHENA_WORKGROUP", "primary").strip() or "primary"

    sql = build_history_sql(
        database=database,
        table=table,
        hub_id=hub_id,
        device_id=device_id,
        hours=hours,
    )
    athena = client or boto3.client("athena")
    started = athena.start_query_execution(
        QueryString=sql,
        QueryExecutionContext={"Database": database},
        ResultConfiguration={"OutputLocation": output},
        WorkGroup=workgroup,
    )
    query_id = started["QueryExecutionId"]
    deadline = time.monotonic() + _MAX_WAIT_SECONDS

    while True:
        execution = athena.get_query_execution(QueryExecutionId=query_id)
        state = execution["QueryExecution"]["Status"]["State"]
        if state == "SUCCEEDED":
            break
        if state in {"FAILED", "CANCELLED"}:
            reason = execution["QueryExecution"]["Status"].get("StateChangeReason", state)
            logger.error("Athena history query failed", extra={"reason": reason, "query_id": query_id})
            raise ApiError("Failed to query telemetry history", 502, "AthenaError")
        if time.monotonic() >= deadline:
            try:
                athena.stop_query_execution(QueryExecutionId=query_id)
            except Exception:
                logger.debug("Failed to stop Athena query", exc_info=True)
            raise ApiError("Telemetry history query timed out", 504, "AthenaTimeout")
        time.sleep(_POLL_SECONDS)

    results = athena.get_query_results(QueryExecutionId=query_id, MaxResults=1000)
    rows = _result_rows(results)
    while results.get("NextToken"):
        results = athena.get_query_results(
            QueryExecutionId=query_id,
            NextToken=results["NextToken"],
            MaxResults=1000,
        )
        rows.extend(_result_rows(results))

    return [row_to_reading(row, device_id=device_id) for row in rows]
