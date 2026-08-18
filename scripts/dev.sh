#!/usr/bin/env bash
# Start SST dev on a personal stage (never int/prod).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"

STAGE="$(homehub_personal_stage)"

if [[ "$STAGE" == "int" || "$STAGE" == "prod" ]]; then
  echo "Refusing to run sst dev against shared stage '$STAGE'."
  echo "Unset SST_STAGE (defaults to your OS username) or set SST_STAGE=yourname."
  echo "Deploy shared stages with: pnpm deploy:int / pnpm deploy:prod"
  exit 1
fi

export SST_STAGE="$STAGE"
# Personal stages deploy to the int workload account; ignore a stray AWS_PROFILE=prod.
export AWS_PROFILE="${AWS_PROFILE_INT:-homehub-int}"
homehub_aws_stage_env "$STAGE"
homehub_aws_check_auth

cd "$ROOT"

echo "SST dev stage: $STAGE (profile=${AWS_PROFILE:-default}, region=${AWS_REGION:-})"
echo "Shared int/prod stacks are untouched. Use pnpm deploy:int for the stable demo."
echo "MQTT runtime: pnpm dev:simulator (local Docker) or pnpm device:deploy (Pi)."

pnpm exec sst unlock --stage "$STAGE"
exec pnpm exec sst dev --stage "$STAGE"
