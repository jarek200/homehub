#!/usr/bin/env bash
# Run the SvelteKit console against an already-deployed backend (int by default).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="${SST_STAGE:-int}"
WEB_ENV="$ROOT/apps/web/.env.local"
OUTPUTS="$ROOT/.sst/outputs.json"

if [[ ! -f "$OUTPUTS" ]]; then
  echo "Missing $OUTPUTS. Deploy first with: pnpm deploy:int" >&2
  exit 1
fi

USER_POOL_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("userPoolId",""))' "$OUTPUTS")"
USER_POOL_CLIENT_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("userPoolClientId",""))' "$OUTPUTS")"
REST_API_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("restApiUrl",""))' "$OUTPUTS")"
EVENTS_HTTP_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("eventsHttpUrl",""))' "$OUTPUTS")"
TABLE_NAME="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("table",""))' "$OUTPUTS")"
WEB_APP_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("webAppUrl",""))' "$OUTPUTS")"

if [[ -z "$USER_POOL_ID" || -z "$USER_POOL_CLIENT_ID" ]]; then
  echo "SST outputs are missing Cognito IDs. Deploy first with: pnpm deploy:int" >&2
  exit 1
fi

REGION="${USER_POOL_ID%%_*}"
if [[ "$REGION" == "$USER_POOL_ID" ]]; then
  REGION="eu-west-1"
fi

cat > "$WEB_ENV" <<EOF
VITE_AWS_REGION=$REGION
VITE_USER_POOL_ID=$USER_POOL_ID
VITE_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
VITE_REST_API_URL=$REST_API_URL
VITE_STAGE=$STAGE
VITE_APP_URL=$WEB_APP_URL
VITE_EVENTS_HTTP_URL=$EVENTS_HTTP_URL
TABLE_NAME=$TABLE_NAME
EOF

echo "Local web → stage $STAGE ($USER_POOL_ID)"
echo "Sign in with the same account you use on $WEB_APP_URL"
cd "$ROOT"
exec pnpm --filter @homehub/web dev
