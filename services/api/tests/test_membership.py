import jwt
from fastapi.testclient import TestClient

from homehub_api.auth import AuthContext
from homehub_api.fake_store import FakeHubStore
from homehub_api.household import hash_email, hash_invite_token
from homehub_api.main import create_app


def _client(store: FakeHubStore, user_id: str, email: str) -> TestClient:
    app = create_app(store=store)

    def _auth() -> AuthContext:
        return AuthContext(user_id=user_id, email=email, auth_method="jwt")

    from homehub_api.auth import verify_api_key_or_jwt

    app.dependency_overrides[verify_api_key_or_jwt] = _auth
    return TestClient(app)


def test_bootstrap_is_idempotent_and_creates_owner() -> None:
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
    with _client(store, "owner-1", "owner@example.com") as client:
        listed = client.get("/household")
    assert listed.status_code == 200
    assert listed.json()["role"] == "OWNER"


def test_owner_can_invite_and_matching_member_can_accept(monkeypatch) -> None:
    store = FakeHubStore()
    store.tenant_pk = "HOUSEHOLD#owner-1"
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "homehub_api.routers.household.invites.send_invite_email",
        lambda email, token: sent.append((email, token)) or {"emailSent": "true"},
    )
    with _client(store, "owner-1", "owner@example.com") as owner:
        owner.post("/household/bootstrap")
        created = owner.post("/household/invites", json={"email": "member@example.com"})
        assert created.status_code == 200
        assert created.json()["status"] == "pending"
        assert sent[0][0] == "member@example.com"
        token = sent[0][1]
        listed = owner.get("/household")
        assert listed.json()["invites"][0]["email"] == "member@example.com"

    with _client(store, "member-1", "member@example.com") as member:
        accepted = member.post("/household/invites/accept", json={"token": token})
        again = member.post("/household/invites/accept", json={"token": token})
    assert accepted.status_code == 200
    assert accepted.json()["role"] == "MEMBER"
    assert again.status_code == 410
    assert store.get_profile("member-1")["householdId"] == "owner-1"
    assert {item["userId"] for item in store.list_members()} == {"owner-1", "member-1"}


def test_invite_rejects_email_mismatch_and_member_cannot_invite(monkeypatch) -> None:
    store = FakeHubStore()
    store.tenant_pk = "HOUSEHOLD#owner-1"
    monkeypatch.setattr(
        "homehub_api.routers.household.invites.send_invite_email",
        lambda email, token: {"emailSent": "true"},
    )
    with _client(store, "owner-1", "owner@example.com") as owner:
        owner.post("/household/bootstrap")
        created = owner.post("/household/invites", json={"email": "member@example.com"})
        token_hash = store.get_invite(created.json()["inviteId"])["tokenHash"]

    # Reconstruct is not needed; use a dummy token that hashes differently.
    with _client(store, "stranger-1", "stranger@example.com") as stranger:
        rejected = stranger.post("/household/invites/accept", json={"token": "not-the-token"})
        assert rejected.status_code in {403, 404, 410}

    store.invite_tokens[token_hash]["status"] = "pending"
    with _client(store, "stranger-1", "stranger@example.com") as stranger:
        # Put the real token hash lookup but a different raw token cannot match.
        store.invite_tokens[hash_invite_token("real-token")] = store.invite_tokens[token_hash]
        denied = stranger.post("/household/invites/accept", json={"token": "real-token"})
        assert denied.status_code == 403

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
    with _client(store, "member-1", "member@example.com") as member:
        forbidden = member.post("/household/invites", json={"email": "third@example.com"})
        assert forbidden.status_code == 403


def test_owner_can_remove_member(monkeypatch) -> None:
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
    assert hash_email(auth.email) == hash_email("pat@example.com")


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
