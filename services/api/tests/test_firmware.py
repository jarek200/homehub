from io import BytesIO

from fastapi.testclient import TestClient


class _FakeS3:
    exceptions = type("E", (), {"ClientError": Exception})()

    def __init__(self, body: bytes = b"fw-image", etag: str = '"abc123abc123abc123abc123abc123ab"'):
        self.body = body
        self.etag = etag

    def get_object(self, **_kwargs):
        return {"ETag": self.etag, "Body": BytesIO(self.body)}


def test_firmware_returns_image(monkeypatch) -> None:
    from homehub_api.main import create_app
    from homehub_api.routers import firmware as firmware_mod

    monkeypatch.setenv("FIRMWARE_BUCKET", "homehub-firmware-int")
    monkeypatch.setattr(firmware_mod.boto3, "client", lambda *_args, **_kwargs: _FakeS3())
    client = TestClient(create_app())
    response = client.get(
        "/firmware/cores3-gateway",
        params={"token": "abc123abc123abc123abc123abc123ab"},
    )
    assert response.status_code == 200
    assert response.content == b"fw-image"
    assert response.headers["content-type"].startswith("application/octet-stream")


def test_firmware_rejects_bad_token(monkeypatch) -> None:
    from homehub_api.main import create_app
    from homehub_api.routers import firmware as firmware_mod

    monkeypatch.setenv("FIRMWARE_BUCKET", "homehub-firmware-int")
    monkeypatch.setattr(firmware_mod.boto3, "client", lambda *_args, **_kwargs: _FakeS3())
    client = TestClient(create_app())
    response = client.get(
        "/firmware/cores3-gateway",
        params={"token": "00000000000000000000000000000000"},
    )
    assert response.status_code == 404
