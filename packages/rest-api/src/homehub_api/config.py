import os
import uuid

from starlette.requests import Request

DEMO_TENANT_ID = "demo"
DEMO_TENANT_PK = f"HUB#{DEMO_TENANT_ID}"

INPUT_LIMITS = {
    "name": 100,
    "type": 64,
    "location": 100,
    "configuration": 4096,
}

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100


def table_name() -> str | None:
    value = os.environ.get("TABLE_NAME", "").strip()
    return value or None


def rest_api_key() -> str | None:
    value = os.environ.get("REST_API_KEY", "").strip()
    return value or None


def hub_pk_for_user(user_id: str) -> str:
    return f"HUB#{user_id}"


def hub_id_from_pk(tenant_pk: str) -> str:
    return tenant_pk.removeprefix("HUB#")


def request_id_from(request: Request) -> str:
    for header in ("x-amzn-requestid", "x-request-id"):
        value = request.headers.get(header)
        if value:
            return value
    return str(uuid.uuid4())
