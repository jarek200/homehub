from fastapi.testclient import TestClient

from homehub_api.auth import AuthContext, verify_api_key_or_jwt
from homehub_api.fake_store import FakeHubStore
from homehub_api.main import create_app


def test_household_state_requires_auth() -> None:
    with TestClient(create_app(store=FakeHubStore())) as client:
        response = client.get("/household/state")
        assert response.status_code == 401


def test_household_state_accepts_verified_user() -> None:
    app = create_app(store=FakeHubStore())
    app.dependency_overrides[verify_api_key_or_jwt] = lambda: AuthContext(
        user_id="user-abc",
        auth_method="jwt",
    )
    with TestClient(app) as client:
        response = client.get("/household/state")
        assert response.status_code == 200
