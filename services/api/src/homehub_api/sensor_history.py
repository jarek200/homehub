"""Last-N contact / motion / leak flips for the website hour-dot strip."""

from __future__ import annotations

from typing import Any

HISTORY_PER_DEVICE = 50
SENSOR_HISTORY_KEY = "sensorHistory"
_KIND_BY_LIST = {
    "contacts": "contact",
    "motions": "motion",
    "leaks": "leak",
}
_VALUES = {
    "contact": {"OPEN", "CLOSED"},
    "motion": {"DETECTED", "CLEAR"},
    "leak": {"LEAK", "DRY"},
}
# Long-lived Dynamo log: entry events only. Clear / closed stay on the live plan.
DURABLE_EVENT_VALUES = {
    "contact": {"OPEN"},
    "motion": {"DETECTED"},
}


def _items(state: dict[str, Any], key: str) -> list[dict[str, Any]]:
    raw = state.get(key)
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict) and item.get("id")]


def _by_id(state: dict[str, Any], key: str) -> dict[str, dict[str, Any]]:
    return {str(item["id"]): item for item in _items(state, key)}


def sanitize_sensor_history(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    cleaned: dict[str, Any] = {}
    for device_id, item in raw.items():
        if not device_id or not isinstance(item, dict):
            continue
        kind = item.get("kind")
        if kind not in _VALUES:
            continue
        events: list[dict[str, str]] = []
        for event in item.get("events") or []:
            if not isinstance(event, dict):
                continue
            at = event.get("at")
            value = event.get("value")
            if not isinstance(at, str) or not at or not isinstance(value, str) or not value:
                continue
            event_kind = event.get("kind") if event.get("kind") in _VALUES else kind
            events.append({"kind": str(event_kind), "at": at, "value": value})
        cleaned[str(device_id)] = {"kind": kind, "events": events[-HISTORY_PER_DEVICE:]}
    return cleaned


def append_sensor_history(
    previous: dict[str, Any] | None,
    current: dict[str, Any] | None,
    recorded_at: str,
) -> dict[str, Any]:
    before = previous if isinstance(previous, dict) else {}
    after = current if isinstance(current, dict) else {}
    history = sanitize_sensor_history(before.get(SENSOR_HISTORY_KEY))
    if not recorded_at:
        return history
    for list_key, kind in _KIND_BY_LIST.items():
        previous_items = _by_id(before, list_key)
        allowed = _VALUES[kind]
        for item in _items(after, list_key):
            device_id = str(item["id"])
            new_value = item.get("state")
            old = previous_items.get(device_id)
            if old is None or new_value not in allowed:
                continue
            old_value = old.get("state")
            if old_value == new_value:
                continue
            entry = history.get(device_id)
            events = list(entry["events"]) if isinstance(entry, dict) else []
            events.append({"kind": kind, "at": recorded_at, "value": str(new_value)})
            history[device_id] = {"kind": kind, "events": events[-HISTORY_PER_DEVICE:]}
    return history


def collect_durable_events(
    previous: dict[str, Any] | None,
    current: dict[str, Any] | None,
    recorded_at: str,
) -> list[dict[str, str]]:
    """OPEN / DETECTED flips to persist forever. Skips first appearance and unchanged state."""
    before = previous if isinstance(previous, dict) else {}
    after = current if isinstance(current, dict) else {}
    if not recorded_at:
        return []
    events: list[dict[str, str]] = []
    for list_key, kind in _KIND_BY_LIST.items():
        durable = DURABLE_EVENT_VALUES.get(kind)
        if not durable:
            continue
        previous_items = _by_id(before, list_key)
        for item in _items(after, list_key):
            device_id = str(item["id"])
            new_value = item.get("state")
            old = previous_items.get(device_id)
            if old is None or new_value not in durable:
                continue
            if old.get("state") == new_value:
                continue
            name = str(item.get("name") or old.get("name") or device_id)
            events.append(
                {
                    "deviceId": device_id,
                    "name": name,
                    "kind": kind,
                    "value": str(new_value),
                    "at": recorded_at,
                }
            )
    return events


def apply_sensor_history(
    previous: dict[str, Any] | None,
    current: dict[str, Any],
    recorded_at: str,
) -> dict[str, Any]:
    next_state = dict(current)
    next_state[SENSOR_HISTORY_KEY] = append_sensor_history(previous, current, recorded_at)
    return next_state
