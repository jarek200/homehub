from homehub_api.sensor_history import (
    append_sensor_history,
    apply_sensor_history,
    collect_durable_events,
)

CLOSED = {
    "contacts": [{"id": "matter-5", "name": "MYGGBETT", "state": "CLOSED"}],
    "motions": [{"id": "matter-4", "name": "MYGGSPRAY", "state": "CLEAR"}],
    "leaks": [{"id": "matter-7", "name": "KLIPPBOK", "state": "DRY"}],
}


def test_records_only_state_flips() -> None:
    opened = {
        **CLOSED,
        "contacts": [{"id": "matter-5", "name": "MYGGBETT", "state": "OPEN"}],
        "motions": [{"id": "matter-4", "name": "MYGGSPRAY", "state": "DETECTED"}],
    }
    history = append_sensor_history(CLOSED, opened, "2026-09-18T16:09:00Z")
    assert history["matter-5"]["events"][-1]["value"] == "OPEN"
    assert history["matter-4"]["events"][-1]["value"] == "DETECTED"
    assert "matter-7" not in history
    held = {**opened, "sensorHistory": history}
    assert append_sensor_history(held, opened, "2026-09-18T16:10:00Z") == history


def test_skips_first_appearance_and_keeps_existing_ring() -> None:
    previous = {
        **CLOSED,
        "sensorHistory": {
            "matter-5": {
                "kind": "contact",
                "events": [{"kind": "contact", "at": "2026-09-18T10:00:00Z", "value": "OPEN"}],
            }
        },
    }
    appeared = {
        **CLOSED,
        "leaks": [{"id": "matter-7", "name": "KLIPPBOK", "state": "LEAK"}],
        "contacts": [{"id": "new-door", "state": "OPEN"}],
    }
    history = append_sensor_history(previous, appeared, "2026-09-18T16:09:00Z")
    assert [event["value"] for event in history["matter-5"]["events"]] == ["OPEN"]
    assert history["matter-7"]["events"][-1]["value"] == "LEAK"
    assert "new-door" not in history


def test_caps_each_device_at_fifty() -> None:
    events = [
        {"kind": "contact", "at": f"2026-09-18T10:{i:02d}:00Z", "value": "OPEN"} for i in range(50)
    ]
    previous = {
        "contacts": [{"id": "matter-5", "state": "CLOSED"}],
        "sensorHistory": {"matter-5": {"kind": "contact", "events": events}},
    }
    current = {"contacts": [{"id": "matter-5", "state": "OPEN"}]}
    history = append_sensor_history(previous, current, "2026-09-18T16:09:00Z")
    assert len(history["matter-5"]["events"]) == 50
    assert history["matter-5"]["events"][0]["at"] == "2026-09-18T10:01:00Z"
    assert history["matter-5"]["events"][-1]["at"] == "2026-09-18T16:09:00Z"


def test_durable_events_keep_open_and_detected_only() -> None:
    opened = {
        **CLOSED,
        "contacts": [{"id": "matter-5", "name": "MYGGBETT", "state": "OPEN"}],
        "motions": [{"id": "matter-4", "name": "MYGGSPRAY", "state": "DETECTED"}],
        "leaks": [{"id": "matter-7", "name": "KLIPPBOK", "state": "LEAK"}],
    }
    events = collect_durable_events(CLOSED, opened, "2026-09-18T16:09:00Z")
    assert {(event["kind"], event["value"]) for event in events} == {
        ("contact", "OPEN"),
        ("motion", "DETECTED"),
    }
    assert collect_durable_events(opened, opened, "2026-09-18T16:10:00Z") == []
    closed = {**opened, "contacts": [{"id": "matter-5", "name": "MYGGBETT", "state": "CLOSED"}]}
    assert collect_durable_events(opened, closed, "2026-09-18T16:11:00Z") == []


def test_apply_replaces_incoming_gateway_history() -> None:
    previous = {
        "contacts": [{"id": "matter-5", "state": "CLOSED"}],
        "sensorHistory": {
            "matter-5": {
                "kind": "contact",
                "events": [{"kind": "contact", "at": "2026-09-18T10:00:00Z", "value": "OPEN"}],
            }
        },
    }
    current = {
        "contacts": [{"id": "matter-5", "state": "OPEN"}],
        "sensorHistory": {},
    }
    merged = apply_sensor_history(previous, current, "2026-09-18T16:09:00Z")
    assert len(merged["sensorHistory"]["matter-5"]["events"]) == 2
    assert merged["sensorHistory"]["matter-5"]["events"][-1]["value"] == "OPEN"
