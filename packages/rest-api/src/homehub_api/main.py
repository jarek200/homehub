import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from homehub_api.config import request_id_from, table_name
from homehub_api.errors import ApiError, error_body
from homehub_api.models import ServiceInfoResponse
from homehub_api.observability import logger
from homehub_api.routers import devices, health, profile
from homehub_api.store import HubStore


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        request_id = request_id_from(request)
        logger.append_keys(
            http_method=request.method,
            path=request.url.path,
            request_id=request_id,
        )
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled request error")
            return JSONResponse(
                status_code=500,
                content=error_body("Internal server error", "InternalError"),
                headers={"X-Request-Id": request_id},
            )
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        response.headers["X-Request-Id"] = request_id
        logger.info(
            "Request completed",
            extra={"status_code": response.status_code, "duration_ms": duration_ms},
        )
        return response


def create_app(store: HubStore | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if store is not None:
            app.state.store = store
            app.state.table_name = None
        else:
            name = table_name()
            if not name:
                raise RuntimeError("TABLE_NAME is required")
            app.state.store = None
            app.state.table_name = name
        yield

    app = FastAPI(
        title="HomeHub Device API",
        version="1.0",
        description="RESTful IoT device management API for the HomeHub interview task.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestLoggingMiddleware)

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        logger.warning(
            "API error",
            extra={
                "status_code": exc.status_code,
                "code": exc.code,
                "path": request.url.path,
            },
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.message, exc.code),
            headers={"X-Request-Id": request_id_from(request)},
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict) and "error" in detail:
            message = str(detail["error"])
            code = detail.get("code")
            if code is not None:
                code = str(code)
        elif isinstance(detail, str):
            message = detail
            code = None
        else:
            message = "Request failed"
            code = None

        logger.warning(
            "HTTP error",
            extra={"status_code": exc.status_code, "code": code, "path": request.url.path},
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(message, code),
            headers={"X-Request-Id": request_id_from(request)},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        messages = []
        for error in exc.errors():
            loc = ".".join(str(part) for part in error.get("loc", []) if part != "body")
            msg = error.get("msg", "Invalid input")
            messages.append(f"{loc}: {msg}" if loc else msg)
        logger.warning(
            "Validation error",
            extra={"path": request.url.path, "details": messages},
        )
        return JSONResponse(
            status_code=400,
            content=error_body("; ".join(messages), "ValidationError"),
            headers={"X-Request-Id": request_id_from(request)},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error", extra={"path": request.url.path})
        return JSONResponse(
            status_code=500,
            content=error_body("Internal server error", "InternalError"),
            headers={"X-Request-Id": request_id_from(request)},
        )

    @app.get("/", response_model=ServiceInfoResponse)
    def root() -> ServiceInfoResponse:
        return ServiceInfoResponse(
            service="HomeHub Device API",
            version="1.0",
            framework="FastAPI",
            endpoints=[
                "GET /health",
                "GET /ready",
                "GET /devices",
                "POST /devices",
                "GET /devices/{deviceId}",
                "PATCH /devices/{deviceId}",
                "DELETE /devices/{deviceId}",
                "GET /devices/{deviceId}/readings",
                "GET /devices/{deviceId}/readings/history",
                "GET /devices/{deviceId}/snapshot",
                "GET /devices/{deviceId}/snapshots",
                "GET /me",
            ],
        )

    app.include_router(health.router)
    app.include_router(devices.router)
    app.include_router(profile.router)

    def custom_openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        components = schema.setdefault("components", {})
        schemes = components.setdefault("securitySchemes", {})
        schemes["ApiKeyAuth"] = {
            "type": "apiKey",
            "in": "header",
            "name": "X-Api-Key",
            "description": "Reviewer / curl API key (when REST_API_KEY is set at deploy).",
        }
        schemes["BearerAuth"] = {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Cognito ID token from a signed-in HomeHub session.",
        }
        schema["security"] = [{"ApiKeyAuth": []}, {"BearerAuth": []}]
        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = custom_openapi  # type: ignore[method-assign]

    return app


app = create_app()
