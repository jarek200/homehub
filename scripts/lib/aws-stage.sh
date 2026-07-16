#!/usr/bin/env bash
# Resolve AWS profile + region to match sst.config.ts stage mapping.

# Personal sst dev stage (never int/prod). Prefer SST_STAGE; else sanitize OS username.
homehub_personal_stage() {
  local stage="${SST_STAGE:-}"
  if [[ -z "$stage" ]]; then
    stage="$(whoami 2>/dev/null || true)"
    stage="${stage:-${USER:-dev}}"
    stage="$(printf '%s' "$stage" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-')"
    stage="${stage#-}"
    stage="${stage%-}"
    stage="${stage:-dev}"
  fi
  printf '%s' "$stage"
}

# True when credentials come from the environment (CI OIDC, assumed role, etc.).
homehub_aws_using_env_credentials() {
  [[ "${CI:-}" == "true" || -n "${AWS_ACCESS_KEY_ID:-}" || -n "${AWS_SECRET_ACCESS_KEY:-}" ]]
}

# Resolve AWS_PROFILE / AWS_REGION for a stage (personal stages → int account).
homehub_aws_stage_env() {
  local stage="${1:-int}"

  # Local SSO only. In CI / with injected keys, leave AWS_PROFILE unset so env creds win
  # (same pattern as sst.config.ts providers.aws.profile).
  if homehub_aws_using_env_credentials; then
    unset AWS_PROFILE
  elif [[ -z "${AWS_PROFILE:-}" ]]; then
    case "$stage" in
      prod) export AWS_PROFILE="${AWS_PROFILE_PROD:-homehub-prod}" ;;
      *) export AWS_PROFILE="${AWS_PROFILE_INT:-homehub-int}" ;;
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
  if aws sts get-caller-identity --output text >/dev/null 2>&1; then
    return 0
  fi

  if homehub_aws_using_env_credentials; then
    echo "AWS credentials are missing or expired (environment / OIDC)."
    echo "In GitHub Actions, ensure aws-actions/configure-aws-credentials ran before this step."
  else
    echo "AWS credentials are missing or expired for profile '${AWS_PROFILE:-default}'."
    echo "Run: pnpm sso"
    echo "Then: pnpm simulator:deploy"
  fi
  return 1
}
