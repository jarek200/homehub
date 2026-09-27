"""Send household invitation emails through SES."""

from __future__ import annotations

import boto3
from botocore.exceptions import ClientError

from homehub_api.household import app_url, ses_from_address
from homehub_api.observability import logger


def invite_link(token: str) -> str:
    path = f"/invite?token={token}"
    base = app_url()
    return f"{base}{path}" if base else path


def send_invite_email(email: str, token: str) -> dict[str, str]:
    from_address = ses_from_address()
    link = invite_link(token)
    body = (
        "You've been invited to join a HomeHub household.\n\n"
        f"Open this link while signed in with {email}:\n{link}\n\n"
        "This invitation expires in 7 days and can only be used once."
    )
    try:
        boto3.client("ses").send_email(
            Source=from_address,
            Destination={"ToAddresses": [email]},
            Message={
                "Subject": {"Data": "Join a HomeHub household", "Charset": "UTF-8"},
                "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
            },
        )
        return {"emailSent": "true"}
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code") or "SendFailed"
        message = exc.response.get("Error", {}).get("Message") or str(exc)
        logger.warning(
            "Invitation email was not delivered",
            extra={"email": email, "code": code, "detail": message},
        )
        if code in {"MessageRejected", "MailFromDomainNotVerified", "ConfigurationSetDoesNotExist"}:
            return {
                "emailSent": "false",
                "emailError": (
                    "Invitation email could not be delivered. SES may still be in sandbox "
                    "or the recipient is not a verified identity."
                ),
            }
        return {"emailSent": "false", "emailError": message}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Invitation email failed", extra={"email": email, "error": str(exc)})
        return {
            "emailSent": "false",
            "emailError": "Email delivery is not configured.",
        }
