"""DynamoDB stream consumer: publish household.state.v1 to AppSync Events."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from typing import Any, cast

import boto3
from boto3.dynamodb.types import TypeDeserializer
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

from homehub_api.household import channel_for_household_pk
from homehub_api.household_events import (
    build_household_state_event,
    is_hub_state_record,
    tenant_pk_from_record,
)
from homehub_api.hub_state import jsonable_plan
from homehub_api.observability import MetricUnit, logger, metrics

_deserializer = TypeDeserializer()


def unmarshal_image(image: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(image, dict):
        return {}
    item: dict[str, Any] = {}
    for key, value in image.items():
        try:
            item[key] = _deserializer.deserialize(value)
        except Exception:
            item[key] = value
    converted = jsonable_plan(item)
    return converted if isinstance(converted, dict) else item


def event_age_ms(record: dict[str, Any]) -> float:
    approx = (record.get("dynamodb") or {}).get("ApproximateCreationDateTime")
    try:
        created = float(cast(Any, approx))
    except (TypeError, ValueError):
        return 0.0
    if created > 1_000_000_000_000:
        created = created / 1000.0
    return max(0.0, (time.time() - created) * 1000.0)


def source_to_publish_latency_ms(payload: dict[str, Any]) -> float:
    raw = payload.get("updatedAt")
    if not isinstance(raw, str) or not raw:
        return 0.0
    try:
        source_time = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if source_time.tzinfo is None:
            source_time = source_time.replace(tzinfo=UTC)
    except ValueError:
        return 0.0
    return max(0.0, (datetime.now(UTC) - source_time).total_seconds() * 1000.0)


def household_event_from_record(record: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    if not is_hub_state_record(record):
        return None
    if record.get("eventName") not in {"INSERT", "MODIFY"}:
        return None
    tenant_pk = tenant_pk_from_record(record)
    if not tenant_pk:
        return None
    channel = channel_for_household_pk(tenant_pk)
    if not channel:
        return None
    item = unmarshal_image((record.get("dynamodb") or {}).get("NewImage"))
    state = item.get("state")
    if not isinstance(state, dict):
        return None
    event_id = str(record.get("eventID") or item.get("updatedAt") or tenant_pk)
    updated_at = item.get("updatedAt") if isinstance(item.get("updatedAt"), str) else None
    return channel, build_household_state_event(
        event_id=event_id,
        state=state,
        updated_at=updated_at,
    )


def publish_household_event(channel: str, payload: dict[str, Any]) -> None:
    endpoint = (os.environ.get("APPSYNC_EVENTS_HTTP_URL") or "").rstrip("/")
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "eu-west-1"
    if not endpoint:
        raise RuntimeError("APPSYNC_EVENTS_HTTP_URL is required")
    url = endpoint if endpoint.endswith("/event") else f"{endpoint}/event"
    body = json.dumps(
        {"channel": channel, "events": [json.dumps(payload, separators=(",", ":"))]}
    ).encode()
    session = boto3.Session()
    credentials = session.get_credentials()
    if credentials is None:
        raise RuntimeError("AWS credentials are required to publish AppSync events")
    frozen = credentials.get_frozen_credentials()
    request = AWSRequest(
        method="POST",
        url=url,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    SigV4Auth(frozen, "appsync", region).add_auth(request)
    prepared = request.prepare()
    http_request = urllib.request.Request(
        prepared.url,
        data=body,
        headers=dict(prepared.headers),
        method="POST",
    )
    try:
        with urllib.request.urlopen(http_request, timeout=8) as response:
            if response.status >= 300:
                raise RuntimeError(f"AppSync publish failed with HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"AppSync publish failed with HTTP {exc.code}: {detail}") from exc


@metrics.log_metrics
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    failures: list[dict[str, str]] = []
    records = event.get("Records") if isinstance(event, dict) else None
    if not isinstance(records, list):
        return {"batchItemFailures": failures}

    for record in records:
        if not isinstance(record, dict):
            continue
        identifier = str(record.get("eventID") or "")
        try:
            parsed = household_event_from_record(record)
            if parsed is None:
                continue
            channel, payload = parsed
            age_ms = event_age_ms(record)
            publish_household_event(channel, payload)
            source_latency_ms = source_to_publish_latency_ms(payload)
            metrics.add_metric("PublishSuccess", MetricUnit.Count, 1)
            if age_ms:
                metrics.add_metric("EventAgeMs", MetricUnit.Milliseconds, age_ms)
            if source_latency_ms:
                metrics.add_metric(
                    "SourceToPublishLatencyMs", MetricUnit.Milliseconds, source_latency_ms
                )
            logger.info(
                "Published household event",
                extra={
                    "channel": channel,
                    "event_id": payload.get("eventId"),
                    "state_version": payload.get("stateVersion"),
                    "event_age_ms": round(age_ms, 2),
                    "source_to_publish_latency_ms": round(source_latency_ms, 2),
                },
            )
        except Exception:
            metrics.add_metric("PublishFailure", MetricUnit.Count, 1)
            logger.exception("Failed to publish household event", extra={"event_id": identifier})
            if identifier:
                failures.append({"itemIdentifier": identifier})

    return {"batchItemFailures": failures}
