import os
import uuid

from starlette.requests import Request

from homehub_api.catalog_data import catalog
from homehub_api.household import DEMO_TENANT_PK as DEMO_TENANT_PK
from homehub_api.household import app_url, household_id_from_pk

_LOCAL_VITE_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")

INPUT_LIMITS = catalog()["inputLimits"]

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100

hub_id_from_pk = household_id_from_pk


def cors_allow_origins() -> list[str]:
    origin = app_url()
    if not origin:
        return ["*"]
    return [origin, *_LOCAL_VITE_ORIGINS]


def table_name() -> str | None:
    value = os.environ.get("TABLE_NAME", "").strip()
    return value or None


def rest_api_key() -> str | None:
    value = os.environ.get("REST_API_KEY", "").strip()
    return value or None


def request_id_from(request: Request) -> str:
    for header in ("x-amzn-requestid", "x-request-id"):
        value = request.headers.get(header)
        if value:
            return value
    return str(uuid.uuid4())
