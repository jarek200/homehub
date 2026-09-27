import jwt
from fastapi.testclient import TestClient

from homehub_api.auth import AuthContext
from homehub_api.fake_store import FakeHubStore
from homehub_api.main import create_app


def _client(store: FakeHubStore, user_id: str, email: str) -> TestClient:
    app = create_app(store=store)

    def _auth() -> AuthContext:
        return AuthContext(user_id=user_id, email=email, auth_method="jwt")

    from homehub_api.auth import verify_api_key_or_jwt

    app.dependency_overrides[verify_api_key_or_jwt] = _auth
    return TestClient(app)


def test_bootstrap_creates_owner_and_home_pointer() -> None:
    store = FakeHubStore()
    store.tenant_pk = "HOUSEHOLD#owner-1"
    with _client(store, "owner-1", "owner@example.com") as client:
        first = client.post("/household/bootstrap")
        second = client.post("/household/bootstrap")
    assert first.status_code == 200
    assert first.json()["role"] == "OWNER"
    assert first.json()["created"] is True
    assert second.json()["created"] is False
    assert store.get_profile("owner-1")["householdId"] == "owner-1"
    assert store.get_member("owner-1")["role"] == "OWNER"
    assert store.household_metadata["ownerUserId"] == "owner-1"
    assert store.home_pointer["householdId"] == "owner-1"
    assert len(store.list_members()) == 1
    with _client(store, "owner-1", "owner@example.com") as client:
        listed = client.get("/household")
    assert listed.status_code == 200
    assert listed.json()["role"] == "OWNER"


def test_second_user_joins_existing_household_as_owner() -> None:
    store = FakeHubStore()
    store.tenant_pk = "HOUSEHOLD#owner-1"
    with _client(store, "owner-1", "owner@example.com") as owner:
        created = owner.post("/household/bootstrap")
    assert created.status_code == 200

    with _client(store, "person-2", "person@example.com") as person:
        joined = person.post("/household/bootstrap")
        again = person.post("/household/bootstrap")
        listed = person.get("/household")

    assert joined.status_code == 200
    assert joined.json()["role"] == "OWNER"
    assert joined.json()["created"] is False
    assert again.json()["created"] is False
    assert store.get_profile("person-2")["householdId"] == "owner-1"
    assert store.get_profile("person-2")["role"] == "OWNER"
    assert store.household_metadata["ownerUserId"] == "owner-1"
    assert store.home_pointer["householdId"] == "owner-1"
    assert {item["userId"] for item in store.list_members()} == {"owner-1", "person-2"}
    assert {item["role"] for item in listed.json()["members"]} == {"OWNER"}
    assert len(store.list_members()) == 2


def test_owner_can_remove_member() -> None:
    store = FakeHubStore()
    store.tenant_pk = "HOUSEHOLD#owner-1"
    with _client(store, "owner-1", "owner@example.com") as owner:
        owner.post("/household/bootstrap")
        store.put_member(
            {
                "userId": "member-1",
                "email": "member@example.com",
                "role": "MEMBER",
                "householdId": "owner-1",
            }
        )
        store.put_profile(
            "member-1",
            {"householdId": "owner-1", "role": "MEMBER", "email": "member@example.com"},
        )
        removed = owner.delete("/household/members/member-1")
    assert removed.status_code == 200
    assert store.get_member("member-1") is None
    assert store.get_profile("member-1")["householdId"] is None


def test_jwt_decode_includes_email_and_groups() -> None:
    token = jwt.encode(
        {"sub": "user-abc", "email": "Pat@Example.com", "cognito:groups": ["hh_user-abc"]},
        "test",
        algorithm="HS256",
    )
    from homehub_api.auth import _auth_from_token

    auth = _auth_from_token(token)
    assert auth.user_id == "user-abc"
    assert auth.email == "pat@example.com"
    assert auth.groups == ["hh_user-abc"]


def test_cognito_username_prefers_user_id() -> None:
    from homehub_api.cognito_groups import cognito_username_for

    assert (
        cognito_username_for(
            {"userId": "user-abc", "email": "pat@example.com"},
            "pat@example.com",
            "user-abc",
        )
        == "user-abc"
    )
