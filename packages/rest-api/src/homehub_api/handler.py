from aws_lambda_powertools.logging import correlation_paths
from mangum import Mangum

from homehub_api.main import app
from homehub_api.observability import logger, metrics, tracer

_asgi_handler = Mangum(app, lifespan="auto")


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_HTTP)
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event, context):
    return _asgi_handler(event, context)
