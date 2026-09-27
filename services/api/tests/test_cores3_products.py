from homehub_api.cores3_products import (
    CORES3_PRODUCTS,
    fabric_reads,
    household_card,
    match_product,
    upsert_household_item,
)


def test_product_ids_match_website_catalog() -> None:
    assert [product["productId"] for product in CORES3_PRODUCTS] == [
        "kajplats",
        "timmerflotte",
        "myggspray",
        "myggbett",
        "alpstuga",
        "klippbok",
        "grillplats",
    ]


def test_upsert_appends_second_light() -> None:
    state = {
        "lights": [{"id": "matter-1", "name": "KAJPLATS", "on": True, "brightness": 100}],
        "plugs": [],
    }
    next_state = upsert_household_item(
        state, "light", household_card("light", "matter-11", "KAJPLATS 2")
    )
    assert [light["id"] for light in next_state["lights"]] == ["matter-1", "matter-11"]


def test_myggspray_reads_occupancy_and_lux_on_correct_endpoints() -> None:
    clusters = ["occupancy", "illuminance", "battery"]
    product = match_product("motion-sensor", clusters)
    assert product is not None
    assert fabric_reads(product, 1, clusters) == [
        {"e": 2, "c": 0x0406, "a": 0},
        {"e": 1, "c": 0x0400, "a": 0},
        {"e": 0, "c": 0x002F, "a": 0x000C},
    ]
