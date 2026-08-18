"""Presigned URLs and time-range listing for camera snapshots in S3."""

from __future__ import annotations

import os
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3

from homehub_api.errors import ApiError
from homehub_api.models import DeviceResponse, DeviceSnapshotListResponse, DeviceSnapshotResponse

SNAPSHOT_URL_EXPIRES_SECONDS = 3600
SNAPSHOT_SAMPLE_LIMIT = 24
SNAPSHOT_MAX_SPAN = timedelta(days=7)
SNAPSHOT_LIST_PAGE_SIZE = 1000
SNAPSHOT_MAX_LIST_PAGES = 40

_STAMP_RE = re.compile(
    r"^snapshots/(?P<device>[^/]+)/(?P<date>\d{4}-\d{2}-\d{2}T)"
    r"(?P<hour>\d{2}):?(?P<minute>\d{2}):?(?P<second>\d{2})"
    r"(?P<fraction>\.\d+)?Z?\.jpg$"
)


def snapshot_bucket() -> str:
    return os.environ.get("SNAPSHOT_BUCKET", "").strip()


def _require_bucket() -> str:
    bucket = snapshot_bucket()
    if not bucket:
        raise ApiError("Snapshot storage is not configured", 503, "ServiceUnavailable")
    return bucket


def parse_query_time(value: str, label: str) -> datetime:
    raw = (value or "").strip()
    if not raw:
        raise ApiError(f"{label} is required", 400, "ValidationError")
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise ApiError(f"Invalid {label} timestamp", 400, "ValidationError") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def validate_snapshot_window(*, start: datetime, end: datetime) -> None:
    if start >= end:
        raise ApiError("'from' must be earlier than 'to'", 400, "ValidationError")
    if end - start > SNAPSHOT_MAX_SPAN:
        raise ApiError("Snapshot range cannot exceed 7 days", 400, "ValidationError")


def recorded_at_from_key(key: str, device_id: str) -> datetime | None:
    match = _STAMP_RE.fullmatch(key)
    if not match or match.group("device") != device_id:
        return None
    iso = (
        f"{match.group('date')}{match.group('hour')}:{match.group('minute')}:"
        f"{match.group('second')}{match.group('fraction') or ''}Z"
    )
    try:
        return parse_query_time(iso, "recordedAt")
    except ApiError:
        return None


def to_recorded_at_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def snapshot_start_after(device_id: str, start: datetime) -> str:
    """Exclusive S3 StartAfter that still includes objects at `start`."""
    stamp = start.astimezone(UTC).strftime("%Y-%m-%dT%H%M%S")
    return f"snapshots/{device_id}/{stamp}"


def sample_evenly[T](items: list[T], limit: int = SNAPSHOT_SAMPLE_LIMIT) -> list[T]:
    """Keep `limit` evenly spaced items, always including the last (newest)."""
    if limit < 1:
        return []
    count = len(items)
    if count <= limit:
        return list(items)
    if limit == 1:
        return [items[-1]]

    indexes: list[int] = []
    for step in range(limit):
        index = round(step * (count - 1) / (limit - 1))
        if not indexes or indexes[-1] != index:
            indexes.append(index)
    if indexes[-1] != count - 1:
        indexes[-1] = count - 1
    return [items[index] for index in indexes]


def _presign_url(s3: Any, bucket: str, key: str) -> str:
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=SNAPSHOT_URL_EXPIRES_SECONDS,
    )


def presigned_snapshot_url(device: DeviceResponse) -> DeviceSnapshotResponse:
    key = (device.last_snapshot_key or "").strip()
    if not key:
        raise ApiError("No snapshot available", 404, "NotFound")

    bucket = _require_bucket()
    url = _presign_url(boto3.client("s3"), bucket, key)
    return DeviceSnapshotResponse(url=url, recordedAt=device.last_snapshot_at)


def list_snapshot_objects(
    *,
    s3: Any,
    bucket: str,
    device_id: str,
    start: datetime,
    end: datetime,
) -> list[tuple[str, datetime]]:
    prefix = f"snapshots/{device_id}/"
    start_after = snapshot_start_after(device_id, start)
    token: str | None = None
    found: list[tuple[str, datetime]] = []

    for _page in range(SNAPSHOT_MAX_LIST_PAGES):
        kwargs: dict[str, Any] = {
            "Bucket": bucket,
            "Prefix": prefix,
            "MaxKeys": SNAPSHOT_LIST_PAGE_SIZE,
        }
        if token:
            kwargs["ContinuationToken"] = token
        else:
            kwargs["StartAfter"] = start_after

        response = s3.list_objects_v2(**kwargs)
        past_window = False
        for obj in response.get("Contents") or []:
            key = str(obj.get("Key") or "")
            recorded_at = recorded_at_from_key(key, device_id)
            if recorded_at is None:
                continue
            if recorded_at < start:
                continue
            if recorded_at > end:
                past_window = True
                break
            found.append((key, recorded_at))

        if past_window or not response.get("IsTruncated"):
            break
        token = response.get("NextContinuationToken")
        if not token:
            break

    return found


def list_device_snapshots(
    device: DeviceResponse,
    *,
    start: datetime,
    end: datetime,
) -> DeviceSnapshotListResponse:
    validate_snapshot_window(start=start, end=end)
    bucket = _require_bucket()
    s3 = boto3.client("s3")
    objects = list_snapshot_objects(
        s3=s3,
        bucket=bucket,
        device_id=device.device_id,
        start=start,
        end=end,
    )
    sampled = sample_evenly(objects, SNAPSHOT_SAMPLE_LIMIT)
    items = [
        DeviceSnapshotResponse(
            url=_presign_url(s3, bucket, key),
            recordedAt=to_recorded_at_iso(recorded_at),
        )
        for key, recorded_at in reversed(sampled)
    ]
    return DeviceSnapshotListResponse(
        items=items,
        sampled=len(objects) > len(sampled),
        total=len(objects),
    )
