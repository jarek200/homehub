import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Request

from homehub_api.errors import ApiError
from homehub_api.models import HealthResponse, ReadyResponse
from homehub_api.observability import logger

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@router.get("/ready", response_model=ReadyResponse)
def ready(request: Request) -> ReadyResponse:
    injected_store = getattr(request.app.state, "store", None)
    if injected_store is not None:
        return ReadyResponse()

    table = getattr(request.app.state, "table_name", None)
    if not table:
        raise ApiError("TABLE_NAME is not configured", 503, "ServiceUnavailable")

    try:
        boto3.client("dynamodb").describe_table(TableName=table)
    except (ClientError, BotoCoreError) as exc:
        logger.warning("Readiness check failed", extra={"table": table, "error": str(exc)})
        raise ApiError("DynamoDB unavailable", 503, "ServiceUnavailable") from exc

    return ReadyResponse()
