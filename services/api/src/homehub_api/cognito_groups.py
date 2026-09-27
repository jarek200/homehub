"""Idempotent Cognito household-group membership."""

from __future__ import annotations

import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

from homehub_api.household import cognito_household_group
from homehub_api.observability import logger


def _user_pool_id() -> str:
    return os.environ.get("COGNITO_USER_POOL_ID", "").strip()


def _client():
    return boto3.client("cognito-idp")


def ensure_household_group(household_id: str) -> str:
    group_name = cognito_household_group(household_id)
    pool_id = _user_pool_id()
    if not pool_id:
        return group_name
    try:
        _client().create_group(
            GroupName=group_name,
            UserPoolId=pool_id,
            Description=f"HomeHub household {household_id}",
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "GroupExistsException":
            raise
    return group_name


def add_user_to_household_group(username: str, household_id: str) -> bool:
    pool_id = _user_pool_id()
    group_name = ensure_household_group(household_id)
    if not pool_id or not username:
        return False
    try:
        _client().admin_add_user_to_group(
            UserPoolId=pool_id,
            Username=username,
            GroupName=group_name,
        )
        return True
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in {"UserNotFoundException", "ResourceNotFoundException"}:
            logger.warning(
                "Cognito household group assignment failed",
                extra={"username": username, "group": group_name, "code": code},
            )
            return False
        raise


def remove_user_from_household_group(username: str, household_id: str) -> None:
    pool_id = _user_pool_id()
    if not pool_id or not username:
        return
    try:
        _client().admin_remove_user_from_group(
            UserPoolId=pool_id,
            Username=username,
            GroupName=cognito_household_group(household_id),
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") not in {
            "UserNotFoundException",
            "ResourceNotFoundException",
            "UserNotInGroupException",
        }:
            raise


def global_sign_out(username: str) -> None:
    pool_id = _user_pool_id()
    if not pool_id or not username:
        return
    try:
        _client().admin_user_global_sign_out(UserPoolId=pool_id, Username=username)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "UserNotFoundException":
            raise


def cognito_username_for(
    profile: dict[str, Any] | None,
    email: str | None,
    user_id: str | None = None,
) -> str:
    if user_id:
        return str(user_id)
    if profile and profile.get("userId"):
        return str(profile["userId"])
    if email:
        return email
    if profile and profile.get("email"):
        return str(profile["email"])
    if profile and profile.get("username"):
        return str(profile["username"])
    return ""
