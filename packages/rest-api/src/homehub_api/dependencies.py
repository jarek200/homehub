from fastapi import Header, HTTPException, Request

from homehub_api.config import rest_api_key
from homehub_api.store import HubStore


def get_store(request: Request) -> HubStore:
    store = getattr(request.app.state, "store", None)
    if store is None:
        raise RuntimeError("Store not initialized")
    return store


def verify_api_key(x_api_key: str | None = Header(default=None, alias="X-Api-Key")) -> None:
    expected = rest_api_key()
    if expected and x_api_key != expected:
        raise HTTPException(
            status_code=401,
            detail={"error": "Invalid or missing API key", "code": "Unauthorized"},
        )
