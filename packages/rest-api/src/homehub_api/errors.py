from typing import Any


class ApiError(Exception):
    def __init__(self, message: str, status_code: int = 400, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def error_body(message: str, code: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"error": message}
    if code:
        body["code"] = code
    return body
