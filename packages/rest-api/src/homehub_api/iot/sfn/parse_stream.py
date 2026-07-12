"""Step 1: Parse EventBridge Pipe / DynamoDB stream input."""

from __future__ import annotations

from typing import Any

from homehub_api.iot.sfn.common import _unwrap_pipe_input, parse_stream_record


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    record = _unwrap_pipe_input(event)
    device = parse_stream_record(record)
    if not device:
        raise ValueError("Stream record is not a PROVISIONING device INSERT")
    return device
