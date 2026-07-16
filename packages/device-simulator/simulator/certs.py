"""Load per-device X.509 certs from SSM Parameter Store."""

from __future__ import annotations

import os
from pathlib import Path

import boto3


def load_cert_paths_for_device(device_id: str, ssm_prefix: str | None = None) -> tuple[str, str, str]:
    prefix = (ssm_prefix or f"/homehub/devices/{device_id}").rstrip("/")
    cert_dir = Path(os.environ.get("CERT_DIR", "/tmp/certs")) / device_id
    cert_dir.mkdir(parents=True, exist_ok=True)
    cert_path = cert_dir / "cert.pem"
    key_path = cert_dir / "key.pem"
    ca_path = cert_dir / "ca.pem"

    ssm = boto3.client("ssm")
    cert_path.write_text(
        ssm.get_parameter(Name=f"{prefix}/cert", WithDecryption=True)["Parameter"]["Value"]
    )
    key_path.write_text(
        ssm.get_parameter(Name=f"{prefix}/key", WithDecryption=True)["Parameter"]["Value"]
    )
    ca_path.write_text(ssm.get_parameter(Name=f"{prefix}/ca", WithDecryption=False)["Parameter"]["Value"])

    cert_path.chmod(0o600)
    key_path.chmod(0o600)

    return str(cert_path), str(key_path), str(ca_path)
