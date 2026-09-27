import boto3
from fastapi import Depends, Request

from homehub_api.auth import AuthContext, verify_api_key_or_jwt
from homehub_api.household import resolve_demo_pk, resolve_household_pk_for_user
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

    dynamo = boto3.resource("dynamodb").Table(table)
    tenant_pk = (
        resolve_household_pk_for_user(dynamo, auth.user_id)
        if auth.user_id
        else resolve_demo_pk(dynamo)
    )
    return HubStore(table, tenant_pk=tenant_pk)
