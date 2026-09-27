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

# Set AWS_PROFILE for a stage even when the shell already has one.
# Personal stages share the int account. Environment credentials (CI) are left alone.
homehub_aws_force_stage_profile() {
  local stage="${1:-int}"
  if homehub_aws_using_env_credentials; then
    unset AWS_PROFILE
    return 0
  fi
  case "$stage" in
    prod) export AWS_PROFILE="${AWS_PROFILE_PROD:-homehub-prod}" ;;
    *) export AWS_PROFILE="${AWS_PROFILE_INT:-homehub-int}" ;;
  esac
}

# Resolve the stage AppTable. Honors TABLE_NAME and HOMEHUB_TABLE_NAME when set.
homehub_app_table() {
  local stage="${1:-${SST_STAGE:-int}}"
  if [[ -n "${TABLE_NAME:-}" && "${TABLE_NAME}" != "None" ]]; then
    printf '%s' "$TABLE_NAME"
    return 0
  fi
  if [[ -n "${HOMEHUB_TABLE_NAME:-}" && "${HOMEHUB_TABLE_NAME}" != "None" ]]; then
    printf '%s' "$HOMEHUB_TABLE_NAME"
    return 0
  fi

  local table
  table="$(
    aws dynamodb list-tables --query \
      "TableNames[?contains(@, 'homehub-${stage}') && contains(@, 'AppTable')]|[0]" \
      --output text
  )"
  if [[ -n "$table" && "$table" != "None" ]]; then
    printf '%s' "$table"
    return 0
  fi

  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  table="$(
    cd "$root" && AWS_PROFILE="${AWS_PROFILE:-}" pnpm exec sst shell --stage "$stage" -- node --input-type=module -e "
import { Resource } from 'sst';
const table = Resource.AppTable?.name;
if (!table) process.exit(1);
console.log(table);
" 2>/dev/null || true
  )"
  if [[ -n "$table" && "$table" != "None" ]]; then
    printf '%s' "$table"
    return 0
  fi
  return 1
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
  fi
  return 1
}
