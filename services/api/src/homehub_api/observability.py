"""AWS Lambda Powertools observability helpers."""

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit

SERVICE_NAME = "homehub-api"
METRICS_NAMESPACE = "HomeHub"

logger = Logger(service=SERVICE_NAME)
tracer = Tracer(service=SERVICE_NAME)
metrics = Metrics(namespace=METRICS_NAMESPACE, service=SERVICE_NAME)

__all__ = ["logger", "tracer", "metrics", "MetricUnit", "SERVICE_NAME", "METRICS_NAMESPACE"]
