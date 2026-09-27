from __future__ import annotations

import os
from dataclasses import dataclass, field

import jwt
from fastapi import Depends, Header
from jwt import PyJWKClient

from homehub_api.config import rest_api_key
from homehub_api.errors import ApiError
from homehub_api.household import normalize_cognito_groups, normalize_email


@dataclass
class AuthContext:
    user_id: str | None = None
    email: str | None = None
    groups: list[str] = field(default_factory=list)
    auth_method: str = "none"


_jwk_client: PyJWKClient | None = None


def _cognito_issuer() -> str | None:
    user_pool_id = os.environ.get("COGNITO_USER_POOL_ID", "").strip()
    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "")).strip()
    if not user_pool_id or not region:
        return None
    return f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"


def _token_payload(token: str) -> dict:
    issuer = _cognito_issuer()
    if not issuer:
        payload = jwt.decode(token, options={"verify_signature": False})
        if not isinstance(payload, dict):
            raise ApiError("Invalid token", 401, "Unauthorized")
        return payload

    global _jwk_client
    jwks_url = f"{issuer}/.well-known/jwks.json"
    if _jwk_client is None:
        _jwk_client = PyJWKClient(jwks_url)
    signing_key = _jwk_client.get_signing_key_from_jwt(token)
    payload = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        issuer=issuer,
        options={"verify_aud": False},
    )
    if not isinstance(payload, dict):
        raise ApiError("Invalid token", 401, "Unauthorized")
    return payload


def _auth_from_token(token: str) -> AuthContext:
    payload = _token_payload(token)
    user_id = payload.get("sub")
    if not user_id:
        raise ApiError("Invalid token", 401, "Unauthorized")
    email = payload.get("email")
    return AuthContext(
        user_id=str(user_id),
        email=normalize_email(str(email)) if email else None,
        groups=normalize_cognito_groups(payload.get("cognito:groups")),
        auth_method="jwt",
    )


def verify_api_key_or_jwt(
    authorization: str | None = Header(default=None, include_in_schema=False),
    x_api_key: str | None = Header(default=None, alias="X-Api-Key", include_in_schema=False),
) -> AuthContext:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        return _auth_from_token(token)

    expected = rest_api_key()
    if expected:
        if x_api_key != expected:
            raise ApiError("Invalid or missing API key", 401, "Unauthorized")
        return AuthContext(user_id=None, auth_method="api_key")

    # Local dev when REST_API_KEY is not configured
    return AuthContext(user_id=None, auth_method="none")


def require_user(
    auth: AuthContext = Depends(verify_api_key_or_jwt),
) -> str:
    if not auth.user_id:
        raise ApiError("Cognito sign-in required", 401, "Unauthorized")
    return auth.user_id


def require_auth(
    auth: AuthContext = Depends(verify_api_key_or_jwt),
) -> AuthContext:
    if not auth.user_id:
        raise ApiError("Cognito sign-in required", 401, "Unauthorized")
    return auth
