"""Optional int-stage check for tenant-isolated household events.

Set HOMEHUB_INT_EVENTS_TEST=1 plus REST_API_URL and a Cognito ID token to run.
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("HOMEHUB_INT_EVENTS_TEST"),
    reason="Set HOMEHUB_INT_EVENTS_TEST=1 to run the int AppSync Events check",
)


def test_authenticated_snapshot_is_tenant_scoped() -> None:
    import urllib.error
    import urllib.request

    base = (os.environ.get("REST_API_URL") or "").rstrip("/")
    token = os.environ.get("HOMEHUB_ID_TOKEN") or ""
    assert base, "REST_API_URL is required"
    assert token, "HOMEHUB_ID_TOKEN is required"
    request = urllib.request.Request(
        f"{base}/household/state",
        headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        assert response.status == 200

    other = urllib.request.Request(
        f"{base}/household/state",
        headers={"Accept": "application/json"},
    )
    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(other, timeout=15)
    assert exc.value.code == 401
