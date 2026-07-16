from __future__ import annotations

import os
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header
from jwt import PyJWKClient

from homehub_api.config import rest_api_key
from homehub_api.errors import ApiError


@dataclass
class AuthContext:
    user_id: str | None = None
    auth_method: str = "none"


_jwk_client: PyJWKClient | None = None


def _cognito_issuer() -> str | None:
    user_pool_id = os.environ.get("COGNITO_USER_POOL_ID", "").strip()
    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "")).strip()
    if not user_pool_id or not region:
        return None
    return f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"


def _verify_bearer_token(token: str) -> str:
    issuer = _cognito_issuer()
    if not issuer:
        payload = jwt.decode(token, options={"verify_signature": False})
        user_id = payload.get("sub")
        if not user_id:
            raise ApiError("Invalid token", 401, "Unauthorized")
        return str(user_id)

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
    user_id = payload.get("sub")
    if not user_id:
        raise ApiError("Invalid token", 401, "Unauthorized")
    return str(user_id)


def verify_api_key_or_jwt(
    authorization: str | None = Header(default=None, include_in_schema=False),
    x_api_key: str | None = Header(default=None, alias="X-Api-Key", include_in_schema=False),
) -> AuthContext:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        user_id = _verify_bearer_token(token)
        return AuthContext(user_id=user_id, auth_method="jwt")

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
