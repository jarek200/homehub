from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from homehub_api.config import table_name
from homehub_api.errors import ApiError
from homehub_api.models import ServiceInfoResponse
from homehub_api.observability import logger
from homehub_api.routers import devices, profile
from homehub_api.store import HubStore


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        logger.append_keys(http_method=request.method, path=request.url.path)
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled request error")
            raise

        logger.info(
            "Request completed",
            extra={"status_code": response.status_code},
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
        body: dict[str, Any] = {"error": exc.message}
        if exc.code:
            body["code"] = exc.code
        return JSONResponse(status_code=exc.status_code, content=body)

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
            content={"error": "; ".join(messages), "code": "ValidationError"},
        )

    @app.get("/", response_model=ServiceInfoResponse)
    def root() -> ServiceInfoResponse:
        return ServiceInfoResponse(
            service="HomeHub Device API",
            version="1.0",
            framework="FastAPI",
            endpoints=[
                "GET /devices",
                "POST /devices",
                "GET /devices/{deviceId}",
                "PATCH /devices/{deviceId}",
                "DELETE /devices/{deviceId}",
                "GET /devices/{deviceId}/readings",
                "GET /devices/{deviceId}/readings/history",
                "GET /me",
            ],
        )

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
