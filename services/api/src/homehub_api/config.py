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
        return list(_LOCAL_VITE_ORIGINS)
    return [origin, *_LOCAL_VITE_ORIGINS]


def table_name() -> str | None:
    value = os.environ.get("TABLE_NAME", "").strip()
    return value or None


_ssm_api_key: str | None = None
_ssm_api_key_loaded = False


def rest_api_key() -> str | None:
    direct = os.environ.get("REST_API_KEY", "").strip()
    if direct:
        return direct
    return _rest_api_key_from_ssm()


def _rest_api_key_from_ssm() -> str | None:
    global _ssm_api_key, _ssm_api_key_loaded
    if _ssm_api_key_loaded:
        return _ssm_api_key

    name = os.environ.get("REST_API_KEY_PARAMETER", "").strip()
    if not name:
        return None

    import boto3

    response = boto3.client("ssm").get_parameter(Name=name, WithDecryption=True)
    value = str(response.get("Parameter", {}).get("Value", "")).strip()
    _ssm_api_key = value or None
    _ssm_api_key_loaded = True
    return _ssm_api_key


def request_id_from(request: Request) -> str:
    for header in ("x-amzn-requestid", "x-request-id"):
        value = request.headers.get(header)
        if value:
            return value
    return str(uuid.uuid4())
