from homehub_api.hub_state import default_household_state


def test_default_household_is_cores3_fabric() -> None:
    state = default_household_state("2026-09-09T00:00:00Z")
    assert [light["id"] for light in state["lights"]] == ["matter-1", "matter-11"]
    assert state["contacts"][0]["id"] == "matter-5"
    assert state["motions"][0]["id"] == "matter-4"
    assert state["leaks"][0]["id"] == "matter-7"
    assert [plug["id"] for plug in state["plugs"]] == ["matter-9", "matter-10"]
