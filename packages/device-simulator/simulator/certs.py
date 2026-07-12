"""Load simulator X.509 certs from disk or SSM Parameter Store."""

from __future__ import annotations

import os
from pathlib import Path

import boto3


def load_cert_paths(cert_dir: str) -> tuple[str, str, str]:
    cert_path = Path(cert_dir) / "cert.pem"
    key_path = Path(cert_dir) / "key.pem"
    ca_path = Path(cert_dir) / "ca.pem"

    if cert_path.exists() and key_path.exists() and ca_path.exists():
        return str(cert_path), str(key_path), str(ca_path)

    prefix = os.environ.get("SSM_CERT_PREFIX", "/homehub/simulator").rstrip("/")
    ssm = boto3.client("ssm")
    cert_path.write_text(
        ssm.get_parameter(Name=f"{prefix}/cert", WithDecryption=True)["Parameter"]["Value"]
    )
    key_path.write_text(
        ssm.get_parameter(Name=f"{prefix}/key", WithDecryption=True)["Parameter"]["Value"]
    )
    ca_path.write_text(ssm.get_parameter(Name=f"{prefix}/ca", WithDecryption=False)["Parameter"]["Value"])
    return str(cert_path), str(key_path), str(ca_path)
