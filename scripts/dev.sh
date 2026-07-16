#!/usr/bin/env bash
# Start SST dev on a personal stage (never int/prod) and optionally auto-deploy Lightsail.
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
homehub_aws_stage_env "$STAGE"

cd "$ROOT"

echo "SST dev stage: $STAGE (profile=${AWS_PROFILE:-default}, region=${AWS_REGION:-})"
echo "Shared int/prod stacks are untouched. Use pnpm deploy:int for the stable demo."

if [[ "${HOMEHUB_SKIP_SIMULATOR:-}" != "true" ]]; then
  # Lightsail only exists on int/prod; this is a no-op for personal stages.
  SIMULATOR_LOG="$ROOT/.homehub-simulator-deploy.log"
  echo "Device simulator check will run in background (log: $SIMULATOR_LOG)"
  bash "$ROOT/scripts/ensure-simulator-deployed.sh" --wait-for-stack >>"$SIMULATOR_LOG" 2>&1 &
  SIMULATOR_PID=$!
  trap 'kill "$SIMULATOR_PID" 2>/dev/null || true' EXIT
fi

exec pnpm exec sst dev --stage "$STAGE"
