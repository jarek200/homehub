from homehub_api.cores3_fabric import (
    cores3_household_state,
    is_legacy_dummy_household_state,
)
from homehub_api.hub_state import default_household_state, normalize_household_state


def test_legacy_dummy_ids_are_detected() -> None:
    assert is_legacy_dummy_household_state(
        {"lock": {"id": "nuki-front", "name": "Front", "state": "LOCKED"}, "lights": []}
    )
    assert is_legacy_dummy_household_state(
        {"lights": [{"id": "living", "name": "Living", "on": True, "brightness": 80}]}
    )
    assert not is_legacy_dummy_household_state(cores3_household_state("2026-09-09T00:00:00Z"))


def test_normalize_replaces_dummy_house() -> None:
    next_state = normalize_household_state(
        {
            "lock": {"id": "nuki-front", "name": "Front", "state": "LOCKED"},
            "lights": [{"id": "living", "name": "Living", "on": True, "brightness": 80}],
            "leaks": [{"id": "leak-bath-2", "name": "Bathroom 2", "state": "LEAK"}],
        }
    )
    assert next_state["lock"] is None
    assert [light["id"] for light in next_state["lights"]] == ["matter-1", "matter-11"]
    assert [leak["id"] for leak in next_state["leaks"]] == ["matter-7"]
    assert [plug["id"] for plug in next_state["plugs"]] == ["matter-9", "matter-10"]


def test_default_household_is_cores3_fabric() -> None:
    state = default_household_state("2026-09-09T00:00:00Z")
    assert [light["id"] for light in state["lights"]] == ["matter-1", "matter-11"]
    assert state["contacts"][0]["id"] == "matter-5"
    assert state["motions"][0]["id"] == "matter-4"
    assert state["leaks"][0]["id"] == "matter-7"
    assert [plug["id"] for plug in state["plugs"]] == ["matter-9", "matter-10"]
