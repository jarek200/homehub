#!/usr/bin/env bash
# Deploy the shared int stack with custom domain (same settings as GitHub Actions).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"

load_local_env() {
  for file in "$ROOT/.env" "$ROOT/.env.local"; do
    if [[ -f "$file" ]]; then
      set -a
      # shellcheck disable=SC1090
      source "$file"
      set +a
    fi
  done
}

load_github_vars() {
  if ! command -v gh >/dev/null 2>&1; then
    return 0
  fi
  if [[ -z "${APP_URL:-}" ]]; then
    APP_URL="$(gh variable get APP_URL_INT 2>/dev/null || true)"
    [[ -n "$APP_URL" ]] && export APP_URL
  fi
  if [[ -z "${APPS_HOSTED_ZONE_ID:-}" ]]; then
    APPS_HOSTED_ZONE_ID="$(gh variable get APPS_HOSTED_ZONE_ID 2>/dev/null || true)"
    [[ -n "$APPS_HOSTED_ZONE_ID" ]] && export APPS_HOSTED_ZONE_ID
  fi
}

export_dns_credentials() {
  if [[ -n "${DNS_AWS_ACCESS_KEY_ID:-}" ]]; then
    return 0
  fi
  if [[ -z "${APP_URL:-}" || -z "${APPS_HOSTED_ZONE_ID:-}" ]]; then
    return 0
  fi

  local dns_profile="${DNS_SOURCE_PROFILE:-admin}"
  if ! aws sts get-caller-identity --profile "$dns_profile" >/dev/null 2>&1; then
    echo "Cannot load DNS credentials from profile '$dns_profile'."
    echo "Run: pnpm sso"
    echo "Or set DNS_AWS_ACCESS_KEY_ID / DNS_AWS_SECRET_ACCESS_KEY / DNS_AWS_SESSION_TOKEN."
    exit 1
  fi

  eval "$(aws configure export-credentials --profile "$dns_profile" --format env)"
  export DNS_AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
  export DNS_AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
  export DNS_AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN"
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
}

load_local_env

if [[ -z "${APP_URL:-}" && -n "${APP_URL_INT:-}" ]]; then
  export APP_URL="$APP_URL_INT"
fi

load_github_vars

# Always target the int workload account, even if the shell has AWS_PROFILE=prod.
export AWS_PROFILE="${AWS_PROFILE_INT:-homehub-int}"
homehub_aws_stage_env int
homehub_aws_check_auth

export_dns_credentials

if [[ -z "${APP_URL:-}" ]]; then
  echo "Warning: APP_URL is unset — deploy will use a random CloudFront URL."
  echo "Set APP_URL in .env.local or ensure gh can read APP_URL_INT."
fi

cd "$ROOT"
pnpm exec sst unlock --stage int
pnpm exec sst deploy --stage int
