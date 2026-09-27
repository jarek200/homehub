from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any

from homehub_api.errors import ApiError
from homehub_api.models import DeviceResponse

DEVICE_CURSOR_PK = "PK"
DEVICE_CURSOR_SK = "SK"


@dataclass
class DeviceListPage:
    items: list[DeviceResponse]
    next_cursor: str | None = None


def encode_device_cursor(key: dict[str, Any]) -> str:
    payload = json.dumps(key, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii")


def decode_device_cursor(cursor: str) -> dict[str, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii"))
        key = json.loads(raw)
        if not isinstance(key, dict):
            raise ValueError("cursor must be an object")
        pk = key.get(DEVICE_CURSOR_PK)
        sk = key.get(DEVICE_CURSOR_SK)
        if not isinstance(pk, str) or not isinstance(sk, str) or not pk or not sk:
            raise ValueError("cursor must include PK and SK")
        return {DEVICE_CURSOR_PK: pk, DEVICE_CURSOR_SK: sk}
    except (ValueError, json.JSONDecodeError, UnicodeError) as exc:
        raise ApiError("Invalid cursor", 400, "ValidationError") from exc
