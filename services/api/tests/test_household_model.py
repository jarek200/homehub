from homehub_api.household import (
    DEMO_TENANT_PK,
    HOME_POINTER_PK,
    HOME_POINTER_SK,
    channel_for_household_pk,
    cognito_household_group,
    household_id_from_pk,
    household_pk,
    normalize_cognito_groups,
    normalize_email,
    normalize_tenant_pk,
    resolve_household_pk_for_gateway,
    resolve_household_pk_for_user,
    snapshot_prefixes,
)


class FakeTable:
    def __init__(self, items: dict[tuple[str, str], dict] | None = None) -> None:
        self.items = items or {}

    def get_item(self, Key):
        item = self.items.get((Key["PK"], Key["SK"]))
        return {"Item": item} if item else {}

    def put_item(self, Item, **kwargs):
        key = (Item["PK"], Item["SK"])
        condition = str(kwargs.get("ConditionExpression") or "")
        if "attribute_not_exists" in condition and key in self.items:
            from botocore.exceptions import ClientError

            raise ClientError(
                {"Error": {"Code": "ConditionalCheckFailedException", "Message": "exists"}},
                "PutItem",
            )
        self.items[key] = dict(Item)

    def scan(self, **kwargs):
        if kwargs.get("ExclusiveStartKey"):
            return {"Items": []}
        return {"Items": [dict(item) for item in self.items.values()]}


def test_household_keys_and_channels() -> None:
    assert household_pk("abc") == "HOUSEHOLD#abc"
    assert household_id_from_pk("HOUSEHOLD#abc") == "abc"
    assert normalize_tenant_pk("abc") == "HOUSEHOLD#abc"
    assert channel_for_household_pk("HOUSEHOLD#abc") == "household/abc"
    assert DEMO_TENANT_PK == "HOUSEHOLD#demo"
    assert cognito_household_group("abc") == "hh_abc"
    assert normalize_email("  Pat@Example.com ") == "pat@example.com"


def test_cognito_group_claim_parsing() -> None:
    assert normalize_cognito_groups(["hh_a", "hh_b"]) == ["hh_a", "hh_b"]
    assert normalize_cognito_groups("hh_a, hh_b") == ["hh_a", "hh_b"]
    assert normalize_cognito_groups('["hh_a","hh_b"]') == ["hh_a", "hh_b"]
    assert normalize_cognito_groups(None) == []


def test_resolve_user_uses_profile_household() -> None:
    table = FakeTable(
        {
            ("USER#u1", "PROFILE"): {"PK": "USER#u1", "SK": "PROFILE", "householdId": "u1"},
            ("HOUSEHOLD#u1", "METADATA"): {
                "PK": "HOUSEHOLD#u1",
                "SK": "METADATA",
                "householdId": "u1",
            },
        }
    )
    assert resolve_household_pk_for_user(table, "u1") == "HOUSEHOLD#u1"
    assert (HOME_POINTER_PK, HOME_POINTER_SK) not in table.items

    missing_profile = FakeTable(
        {("HOUSEHOLD#u2", "HUB_STATE"): {"PK": "HOUSEHOLD#u2", "SK": "HUB_STATE", "state": {}}}
    )
    assert resolve_household_pk_for_user(missing_profile, "u2") == "HOUSEHOLD#u2"
    assert (HOME_POINTER_PK, HOME_POINTER_SK) not in missing_profile.items


def test_resolve_user_uses_home_pointer() -> None:
    table = FakeTable(
        {
            (HOME_POINTER_PK, HOME_POINTER_SK): {
                "PK": HOME_POINTER_PK,
                "SK": HOME_POINTER_SK,
                "householdId": "family-1",
            }
        }
    )
    assert resolve_household_pk_for_user(table, "new-user") == "HOUSEHOLD#family-1"


def test_resolve_user_without_pointer_uses_own_id() -> None:
    table = FakeTable(
        {
            ("HOUSEHOLD#demo", "METADATA"): {
                "PK": "HOUSEHOLD#demo",
                "SK": "METADATA",
                "householdId": "demo",
            },
            ("HOUSEHOLD#family-1", "METADATA"): {
                "PK": "HOUSEHOLD#family-1",
                "SK": "METADATA",
                "householdId": "family-1",
            },
        }
    )
    assert resolve_household_pk_for_user(table, "new-user") == "HOUSEHOLD#new-user"
    assert (HOME_POINTER_PK, HOME_POINTER_SK) not in table.items


def test_resolve_gateway_uses_lookup_without_scan() -> None:
    table = FakeTable({("GATEWAY#gw-1", "HOUSEHOLD"): {"householdId": "family-1"}})
    assert resolve_household_pk_for_gateway(table, "gw-1", "demo") == "HOUSEHOLD#family-1"

    fallback = FakeTable({("HOUSEHOLD#demo", "HUB_STATE"): {"state": {}}})
    assert resolve_household_pk_for_gateway(fallback, "missing", "demo") == "HOUSEHOLD#demo"


def test_snapshot_prefixes_include_household_and_thing() -> None:
    assert snapshot_prefixes("cam-1", "family-1") == [
        "snapshots/family-1/cam-1/",
        "snapshots/homehub-cam-1/",
    ]
    assert snapshot_prefixes("cam-1", "family-1", "homehub-cam-1") == [
        "snapshots/family-1/cam-1/",
        "snapshots/homehub-cam-1/",
    ]
