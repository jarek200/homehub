#!/usr/bin/env bash
# Run the device simulator locally against the deployed int stack (same SQS/table/IoT as pnpm dev).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${SST_STAGE:-int}"

cd "$ROOT"

# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"
homehub_aws_stage_env "$STAGE"
homehub_aws_check_auth

echo "Loading stack outputs from stage: $STAGE (profile=${AWS_PROFILE:-default}, region=$AWS_REGION)"

eval "$(
  pnpm exec sst shell --stage "$STAGE" -- node --input-type=module -e "
import { Resource } from 'sst';
const table = Resource.AppTable?.name;
const queue = Resource.SimulatorEvents?.url;
if (!table || !queue) {
  console.error('Missing AppTable or SimulatorEvents — run pnpm dev or pnpm deploy:int first');
  process.exit(1);
}
console.log('export TABLE_NAME=' + JSON.stringify(table));
console.log('export SQS_QUEUE_URL=' + JSON.stringify(queue));
"
)"

IOT_HOST="$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --region "$AWS_REGION" --query endpointAddress --output text)"
export IOT_ENDPOINT="https://${IOT_HOST}"

cd "$ROOT/packages/device-simulator"
echo "Starting simulator (TABLE_NAME=$TABLE_NAME, stage=$STAGE)"
docker compose up --build
