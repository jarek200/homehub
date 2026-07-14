import os

# Keep local pytest runs quiet — no X-Ray daemon / EMF flush noise.
os.environ.setdefault("POWERTOOLS_TRACE_DISABLED", "true")
os.environ.setdefault("POWERTOOLS_METRICS_DISABLED", "true")
os.environ.setdefault("POWERTOOLS_SERVICE_NAME", "homehub-api")
os.environ.setdefault("POWERTOOLS_METRICS_NAMESPACE", "HomeHub")
