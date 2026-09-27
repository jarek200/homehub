import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_API_KEY = "test-api-key"
os.environ.setdefault("REST_API_KEY", TEST_API_KEY)


def open_api_client(app: FastAPI) -> TestClient:
    key = os.environ.get("REST_API_KEY", "")
    headers = {"X-Api-Key": key} if key else {}
    return TestClient(app, headers=headers)
