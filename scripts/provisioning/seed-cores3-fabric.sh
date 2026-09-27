#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=../lib/aws-stage.sh
source "$(dirname "$0")/../lib/aws-stage.sh"

stage="${1:-int}"
homehub_aws_stage_env "$stage"
homehub_aws_check_auth

if [[ -z "${TABLE_NAME:-}" ]]; then
  TABLE_NAME="$(
    AWS_PROFILE="${AWS_PROFILE:-}" aws dynamodb list-tables --query \
      "TableNames[?contains(@, 'AppTable')]|[0]" --output text
  )"
  export TABLE_NAME
fi

if [[ -z "${TABLE_NAME}" || "${TABLE_NAME}" == "None" ]]; then
  echo "Could not resolve TABLE_NAME. Pass it explicitly."
  exit 1
fi

echo "Seeding CoreS3 fabric into ${TABLE_NAME} (stage ${stage})"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
uv run --directory "$ROOT/services/api" python "$ROOT/scripts/provisioning/seed-cores3-fabric.py"
