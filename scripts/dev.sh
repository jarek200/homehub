#!/usr/bin/env bash
# Start SST dev and auto-deploy the Lightsail device simulator once the stack is ready.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${SST_STAGE:-int}"

cd "$ROOT"

if [[ "${HOMEHUB_SKIP_IOT_PROVISIONING:-}" != "true" && "${HOMEHUB_SKIP_SIMULATOR:-}" != "true" ]]; then
  SIMULATOR_LOG="$ROOT/.homehub-simulator-deploy.log"
  echo "Device simulator will auto-deploy in background (log: $SIMULATOR_LOG)"
  bash "$ROOT/scripts/ensure-simulator-deployed.sh" --wait-for-stack >>"$SIMULATOR_LOG" 2>&1 &
  SIMULATOR_PID=$!
  trap 'kill "$SIMULATOR_PID" 2>/dev/null || true' EXIT
fi

exec pnpm exec sst dev --stage "$STAGE"
