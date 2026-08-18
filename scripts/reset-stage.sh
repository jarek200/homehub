#!/usr/bin/env bash
# Tear down an SST stage and remove simulator orphans so the next deploy starts clean.
#
# Usage:
#   pnpm reset:int
#   bash scripts/reset-stage.sh int
#
# After reset, redeploy with: pnpm deploy:int
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${1:-int}"

if [[ "$STAGE" == "prod" ]]; then
  echo "Refusing to reset prod without explicit confirmation."
  echo "Run: CONFIRM_RESET_PROD=true bash scripts/reset-stage.sh prod"
  exit 1
fi

if [[ "$STAGE" != "int" ]]; then
  echo "Only int can be reset without confirmation (got stage=$STAGE)."
  exit 1
fi

# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"
homehub_aws_stage_env "$STAGE"
homehub_aws_check_auth

echo "Removing SST stage '$STAGE' (profile=${AWS_PROFILE:-default})..."
cd "$ROOT"
pnpm exec sst remove --stage "$STAGE"

echo "Removing leftover AWS resources not tracked in SST state..."
HOMEHUB_CLEAN_RUNTIME_IAM=true bash "$ROOT/scripts/cleanup-simulator-orphans.sh" "$STAGE"

echo ""
echo "Reset complete for stage '$STAGE'."
echo "Redeploy with: pnpm deploy:int"
