#!/usr/bin/env bash
# Resolve AWS profile + region to match sst.config.ts stage mapping.
homehub_aws_stage_env() {
  local stage="${1:-int}"

  if [[ -z "${AWS_PROFILE:-}" ]]; then
    case "$stage" in
      int) export AWS_PROFILE="${AWS_PROFILE_INT:-homehub-int}" ;;
      prod) export AWS_PROFILE="${AWS_PROFILE_PROD:-homehub-prod}" ;;
    esac
  fi

  # Prefer the stage profile's region over inherited shell AWS_REGION (often eu-west-2).
  local profile_region=""
  if [[ -n "${AWS_PROFILE:-}" ]]; then
    profile_region="$(aws configure get region --profile "$AWS_PROFILE" 2>/dev/null || true)"
  fi

  if [[ -n "$profile_region" ]]; then
    export AWS_REGION="$profile_region"
  else
    export AWS_REGION="${HOMEHUB_AWS_REGION:-${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-west-1}}}"
  fi
}

homehub_aws_check_auth() {
  if ! aws sts get-caller-identity --output text >/dev/null 2>&1; then
    echo "AWS credentials are missing or expired for profile '${AWS_PROFILE:-default}'."
    echo "Run: pnpm sso"
    echo "Then: pnpm simulator:deploy"
    return 1
  fi
}
