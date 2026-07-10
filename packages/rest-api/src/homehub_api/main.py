from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from homehub_api.config import table_name
from homehub_api.errors import ApiError
from homehub_api.models import ServiceInfoResponse
from homehub_api.routers import devices, issues
from homehub_api.store import HubStore, build_store


def create_app(store: HubStore | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if store is not None:
            app.state.store = store
        else:
            name = table_name()
            if not name:
                raise RuntimeError("TABLE_NAME is required")
            app.state.store = build_store(name)
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

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
        body: dict[str, Any] = {"error": exc.message}
        if exc.code:
            body["code"] = exc.code
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        messages = []
        for error in exc.errors():
            loc = ".".join(str(part) for part in error.get("loc", []) if part != "body")
            msg = error.get("msg", "Invalid input")
            messages.append(f"{loc}: {msg}" if loc else msg)
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
                "POST /devices/{deviceId}/readings",
                "GET /devices/{deviceId}/commands",
                "POST /devices/{deviceId}/commands",
                "GET /issues",
                "POST /issues",
                "GET /issues/{issueId}",
                "PATCH /issues/{issueId}",
            ],
        )

    app.include_router(devices.router)
    app.include_router(issues.router)

    return app


app = create_app()
