import jwt
from fastapi.testclient import TestClient

from homehub_api.fake_store import FakeHubStore
from homehub_api.main import create_app


def test_household_state_requires_auth() -> None:
    with TestClient(create_app(store=FakeHubStore())) as client:
        response = client.get("/household/state")
        assert response.status_code == 401


def test_household_state_accepts_jwt() -> None:
    token = jwt.encode({"sub": "user-abc"}, "test", algorithm="HS256")
    with TestClient(create_app(store=FakeHubStore())) as client:
        response = client.get("/household/state", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
