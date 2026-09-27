from homehub_api.household import (
    DEMO_TENANT_PK,
    channel_for_household_pk,
    cognito_household_group,
    hash_email,
    hash_invite_token,
    household_id_from_pk,
    household_pk,
    invite_expires_at,
    is_invite_expired,
    is_valid_email,
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

    def scan(self, **_kwargs):
        raise AssertionError("request paths must not scan")


def test_household_keys_and_channels() -> None:
    assert household_pk("abc") == "HOUSEHOLD#abc"
    assert household_id_from_pk("HOUSEHOLD#abc") == "abc"
    assert normalize_tenant_pk("abc") == "HOUSEHOLD#abc"
    assert channel_for_household_pk("HOUSEHOLD#abc") == "household/abc"
    assert DEMO_TENANT_PK == "HOUSEHOLD#demo"
    assert cognito_household_group("abc") == "hh_abc"


def test_invite_email_and_token_hashing() -> None:
    assert normalize_email("  Pat@Example.com ") == "pat@example.com"
    assert is_valid_email("pat@example.com")
    assert not is_valid_email("not-an-email")
    assert hash_email("Pat@Example.com") == hash_email("pat@example.com")
    assert hash_invite_token("a") != hash_invite_token("b")
    expires = invite_expires_at()
    assert not is_invite_expired(expires)
    assert is_invite_expired(1)


def test_cognito_group_claim_parsing() -> None:
    assert normalize_cognito_groups(["hh_a", "hh_b"]) == ["hh_a", "hh_b"]
    assert normalize_cognito_groups("hh_a, hh_b") == ["hh_a", "hh_b"]
    assert normalize_cognito_groups('["hh_a","hh_b"]') == ["hh_a", "hh_b"]
    assert normalize_cognito_groups(None) == []


def test_resolve_user_uses_profile_household() -> None:
    table = FakeTable(
        {
            ("USER#u1", "PROFILE"): {"householdId": "u1"},
            ("HOUSEHOLD#u1", "METADATA"): {"householdId": "u1"},
        }
    )
    assert resolve_household_pk_for_user(table, "u1") == "HOUSEHOLD#u1"

    missing_profile = FakeTable({("HOUSEHOLD#u2", "HUB_STATE"): {"state": {"scene": "home"}}})
    assert resolve_household_pk_for_user(missing_profile, "u2") == "HOUSEHOLD#u2"


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
