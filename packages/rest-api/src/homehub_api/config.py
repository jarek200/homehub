import os

DEMO_TENANT_PK = "HUB#demo"
HUMIDITY_ISSUE_THRESHOLD = 70

INPUT_LIMITS = {
    "name": 100,
    "type": 64,
    "location": 100,
    "configuration": 4096,
    "command": 64,
    "issue_title": 200,
    "issue_notes": 2000,
    "bio": 500,
    "avatar": 2048,
}


def table_name() -> str | None:
    value = os.environ.get("TABLE_NAME", "").strip()
    return value or None


def rest_api_key() -> str | None:
    value = os.environ.get("REST_API_KEY", "").strip()
    return value or None
