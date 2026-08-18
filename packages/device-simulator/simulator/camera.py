"""Capture a Camera Module 3 still and upload it to S3."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

import boto3

logger = logging.getLogger(__name__)

CAPTURE_TIMEOUT_SECONDS = 20
CAPTURE_SETTLE_MS = 300
_capture_lock = threading.Lock()


def snapshot_bucket() -> str:
    return os.environ.get("SNAPSHOT_BUCKET", "").strip()


def capture_jpeg(output_path: Path) -> bool:
    binary = shutil.which("rpicam-still") or shutil.which("libcamera-still")
    if not binary:
        logger.info("rpicam-still not found — skipping camera capture")
        return False

    command = [
        binary,
        "-n",
        "-o",
        str(output_path),
        "--width",
        "1920",
        "--height",
        "1080",
        "-t",
        str(CAPTURE_SETTLE_MS),
    ]
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            timeout=CAPTURE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        logger.warning("Camera capture failed", exc_info=True)
        return False

    if result.returncode != 0 or not output_path.is_file() or output_path.stat().st_size == 0:
        stderr = result.stderr.decode(errors="replace").strip() if result.stderr else ""
        logger.warning("Camera capture exited %s: %s", result.returncode, stderr)
        return False
    return True


def upload_snapshot(*, device_id: str, recorded_at: str, jpeg_path: Path) -> str | None:
    bucket = snapshot_bucket()
    if not bucket:
        logger.info("SNAPSHOT_BUCKET unset — skipping snapshot upload")
        return None

    safe_stamp = recorded_at.replace(":", "").replace("+00:00", "Z")
    key = f"snapshots/{device_id}/{safe_stamp}.jpg"
    try:
        boto3.client("s3").put_object(
            Bucket=bucket,
            Key=key,
            Body=jpeg_path.read_bytes(),
            ContentType="image/jpeg",
        )
    except Exception:
        logger.exception("Failed to upload snapshot for %s", device_id)
        return None
    return key


def capture_and_upload(*, device_id: str, recorded_at: str) -> str | None:
    with _capture_lock:
        with tempfile.TemporaryDirectory(prefix="homehub-snap-") as tmp:
            jpeg_path = Path(tmp) / "snap.jpg"
            if not capture_jpeg(jpeg_path):
                return None
            return upload_snapshot(device_id=device_id, recorded_at=recorded_at, jpeg_path=jpeg_path)
