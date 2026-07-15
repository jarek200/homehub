#!/usr/bin/env bash
# Run the device simulator locally against the personal sst dev stage (same SQS/table/IoT as pnpm dev).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"

STAGE="$(homehub_personal_stage)"
export SST_STAGE="$STAGE"

cd "$ROOT"

homehub_aws_stage_env "$STAGE"
homehub_aws_check_auth

echo "Loading stack outputs from stage: $STAGE (profile=${AWS_PROFILE:-default}, region=$AWS_REGION)"

eval "$(
  pnpm exec sst shell --stage "$STAGE" -- node --input-type=module -e "
import { Resource } from 'sst';
const table = Resource.AppTable?.name;
const queue = Resource.SimulatorEvents?.url;
if (!table || !queue) {
  console.error('Missing AppTable or SimulatorEvents — run pnpm dev first');
  process.exit(1);
}
console.log('export TABLE_NAME=' + JSON.stringify(table));
console.log('export SQS_QUEUE_URL=' + JSON.stringify(queue));
"
)"

IOT_HOST="$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --region "$AWS_REGION" --query endpointAddress --output text)"
export IOT_ENDPOINT="https://${IOT_HOST}"
export AWS_DEFAULT_REGION="$AWS_REGION"

# Container has no SSO session — export short-lived keys from the host profile.
eval "$(aws configure export-credentials --profile "${AWS_PROFILE}" --format env)"

cd "$ROOT/packages/device-simulator"
echo "Starting simulator (TABLE_NAME=$TABLE_NAME, stage=$STAGE, region=$AWS_REGION)"
docker compose up --build
