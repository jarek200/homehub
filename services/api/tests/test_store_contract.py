import inspect

from homehub_api.fake_store import FakeHubStore
from homehub_api.store import HubStore


def _public_methods(cls: type) -> set[str]:
    return {
        name
        for name, member in inspect.getmembers(cls, predicate=inspect.isfunction)
        if not name.startswith("_")
    }


def test_fake_hub_store_covers_hub_store_public_methods() -> None:
    missing = _public_methods(HubStore) - _public_methods(FakeHubStore)
    assert missing == set(), f"FakeHubStore is missing HubStore methods: {sorted(missing)}"
