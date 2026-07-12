from fastapi import Depends, Request

from homehub_api.auth import verify_api_key_or_jwt
from homehub_api.store import HubStore


def get_store(request: Request) -> HubStore:
    store = getattr(request.app.state, "store", None)
    if store is None:
        raise RuntimeError("Store not initialized")
    return store
