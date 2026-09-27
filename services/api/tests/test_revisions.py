from botocore.exceptions import ClientError

from homehub_api.errors import ApiError
from homehub_api.revisions import commit_hub_state, revision_of


class FakeTable:
    def __init__(self) -> None:
        self.item: dict | None = None
        self.attempts = 0
        self.fail_once = False

    def get_item(self, Key):
        return {"Item": dict(self.item)} if self.item else {}

    def put_item(self, Item, **kwargs):
        self.attempts += 1
        if self.fail_once:
            self.fail_once = False
            raise ClientError(
                {"Error": {"Code": "ConditionalCheckFailedException", "Message": "race"}},
                "PutItem",
            )
        self.item = Item


def test_revision_of_reads_item_then_state_version() -> None:
    assert revision_of({"revision": 4}) == 4
    assert revision_of({"state": {"stateVersion": 2}}) == 2
    assert revision_of(None) == 0


def test_commit_hub_state_increments_and_retries() -> None:
    table = FakeTable()
    first = commit_hub_state(table, "HOUSEHOLD#demo", lambda current: {**current, "scene": "home"})
    assert first["stateVersion"] == 1
    assert table.item["revision"] == 1

    table.fail_once = True
    second = commit_hub_state(table, "HOUSEHOLD#demo", lambda current: {**current, "scene": "away"})
    assert second["stateVersion"] == 2
    assert second["scene"] == "away"
    assert table.attempts >= 3


def test_commit_hub_state_raises_after_bounded_retries() -> None:
    table = FakeTable()

    def always_fail(**_kwargs):
        raise ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException", "Message": "race"}},
            "PutItem",
        )

    table.put_item = always_fail  # type: ignore[method-assign]
    try:
        commit_hub_state(table, "HOUSEHOLD#demo", lambda current: current, max_attempts=2)
        raise AssertionError("expected conflict")
    except ApiError as exc:
        assert exc.status_code == 409
        assert exc.code == "Conflict"
