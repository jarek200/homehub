"""Step Functions Catch: mark device FAILED and rollback cert if created."""

from __future__ import annotations

import os
from typing import Any

import boto3

from homehub_api.iot.sfn.common import _now_iso, ssm_prefix_for


def _delete_ssm_prefix(prefix: str) -> None:
    ssm = boto3.client("ssm")
    for suffix in ("cert", "key", "ca"):
        name = f"{prefix}/{suffix}"
        try:
            ssm.delete_parameter(Name=name)
        except ssm.exceptions.ParameterNotFound:
            pass


def _deactivate_cert(certificate_id: str | None) -> None:
    if not certificate_id:
        return
    iot = boto3.client("iot")
    try:
        iot.update_certificate(certificateId=certificate_id, newStatus="INACTIVE")
        iot.delete_certificate(certificateId=certificate_id, forceDelete=True)
    except Exception:
        pass


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    table_name = os.environ["TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    error_info = event.get("error") or {}
    cause = (
        error_info.get("Cause")
        or error_info.get("Error")
        or event.get("Cause")
        or event.get("errorMessage")
        or "Provisioning failed"
    )
    if isinstance(cause, str) and len(cause) > 500:
        cause = cause[:500]

    device_id = event.get("deviceId")
    tenant_pk = event.get("tenantPk")
    if not device_id or not tenant_pk:
        return {"markedFailed": False, "reason": "Missing device context"}

    _deactivate_cert(event.get("certificateId"))
    prefix = event.get("ssmCertPrefix") or (ssm_prefix_for(device_id) if device_id else "")
    if prefix:
        _delete_ssm_prefix(prefix)

    table.update_item(
        Key={"PK": tenant_pk, "SK": f"DEVICE#{device_id}"},
        UpdateExpression=(
            "SET lifecycleStatus = :failed, failureReason = :reason, updatedAt = :updatedAt"
        ),
        ExpressionAttributeValues={
            ":failed": "FAILED",
            ":reason": str(cause),
            ":updatedAt": _now_iso(),
        },
    )

    return {"deviceId": device_id, "lifecycleStatus": "FAILED", "failureReason": str(cause)}
