from fastapi import Depends, Request

from homehub_api.auth import AuthContext, verify_api_key_or_jwt
from homehub_api.config import DEMO_TENANT_PK, hub_pk_for_user
from homehub_api.store import HubStore


def get_store(
    request: Request,
    auth: AuthContext = Depends(verify_api_key_or_jwt),
) -> HubStore:
    injected = getattr(request.app.state, "store", None)
    if injected is not None:
        return injected

    table = getattr(request.app.state, "table_name", None)
    if not table:
        raise RuntimeError("TABLE_NAME is required")

    tenant_pk = hub_pk_for_user(auth.user_id) if auth.user_id else DEMO_TENANT_PK
    return HubStore(table, tenant_pk=tenant_pk)
