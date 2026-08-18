#!/usr/bin/env bash
# Remove leftover device-runtime AWS resources after a failed deploy or Lightsail teardown.
#
# Use when sst deploy fails with EntityAlreadyExists for simulator IAM/ECR/etc,
# or after removing Lightsail from the stack.
# Safe to re-run; no-ops when resources are absent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${1:-int}"

if [[ "$STAGE" != "int" && "$STAGE" != "prod" ]]; then
  echo "Runtime orphans are only cleaned for int/prod (got stage=$STAGE)."
  exit 1
fi

# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"
homehub_aws_stage_env "$STAGE"
homehub_aws_check_auth

USER_NAME="homehub-${STAGE}-device-simulator"
SSM_KEY_ID="/homehub/${STAGE}/simulator/access-key-id"
SSM_SECRET="/homehub/${STAGE}/simulator/secret-access-key"
LIGHTSAIL_SERVICE="homehub-${STAGE}-simulator"
ECR_REPO="homehub-device-simulator-${STAGE}"

echo "Cleaning device-runtime orphans (stage=$STAGE, profile=${AWS_PROFILE:-default}, region=$AWS_REGION)"

delete_iam_user() {
  local user="$1"
  if ! aws iam get-user --user-name "$user" >/dev/null 2>&1; then
    echo "  IAM user $user: not found (skip)"
    return 0
  fi

  echo "  IAM user $user: deleting access keys and policies"
  aws iam list-access-keys --user-name "$user" \
    --query 'AccessKeyMetadata[].AccessKeyId' --output text \
    | tr '\t' '\n' | while read -r key; do
      [[ -n "$key" ]] && aws iam delete-access-key --user-name "$user" --access-key-id "$key"
    done

  aws iam list-user-policies --user-name "$user" \
    --query 'PolicyNames[]' --output text \
    | tr '\t' '\n' | while read -r policy; do
      [[ -n "$policy" ]] && aws iam delete-user-policy --user-name "$user" --policy-name "$policy"
    done

  aws iam delete-user --user-name "$user"
  echo "  IAM user $user: deleted"
}

delete_ssm_param() {
  local name="$1"
  if aws ssm get-parameter --name "$name" >/dev/null 2>&1; then
    aws ssm delete-parameter --name "$name"
    echo "  SSM $name: deleted"
  else
    echo "  SSM $name: not found (skip)"
  fi
}

delete_lightsail_service() {
  local name="$1"
  if aws lightsail get-container-services --region "$AWS_REGION" \
    --query "containerServices[?containerServiceName=='${name}'].containerServiceName" \
    --output text 2>/dev/null | grep -q "$name"; then
    echo "  Lightsail $name: deleting"
    aws lightsail delete-container-service --region "$AWS_REGION" --service-name "$name" >/dev/null
    echo "  Lightsail $name: deleted"
  else
    echo "  Lightsail $name: not found (skip)"
  fi
}

delete_ecr_repo() {
  local name="$1"
  if aws ecr describe-repositories --repository-names "$name" --region "$AWS_REGION" >/dev/null 2>&1; then
    echo "  ECR $name: deleting"
    aws ecr delete-repository --repository-name "$name" --region "$AWS_REGION" --force >/dev/null
    echo "  ECR $name: deleted"
  else
    echo "  ECR $name: not found (skip)"
  fi
}

delete_lightsail_service "$LIGHTSAIL_SERVICE"
delete_ecr_repo "$ECR_REPO"

if [[ "${HOMEHUB_CLEAN_RUNTIME_IAM:-}" == "true" ]]; then
  delete_iam_user "$USER_NAME"
  delete_ssm_param "$SSM_KEY_ID"
  delete_ssm_param "$SSM_SECRET"
else
  echo "Keeping IAM/SSM runtime credentials (set HOMEHUB_CLEAN_RUNTIME_IAM=true to delete)."
fi

echo "Removing leftover SST state (if tracked)..."
cd "$ROOT"
state_targets=(
  DeviceSimulator
  DeviceSimulatorEcr
  DeviceSimulatorEcrPolicy
)
if [[ "${HOMEHUB_CLEAN_RUNTIME_IAM:-}" == "true" ]]; then
  state_targets+=(
    DeviceSimulatorSecretAccessKey
    DeviceSimulatorAccessKeyId
    DeviceSimulatorUserPolicy
    DeviceSimulatorAccessKey
    DeviceSimulatorUser
  )
fi
for target in "${state_targets[@]}"; do
  if pnpm exec sst state export --stage "$STAGE" 2>/dev/null | grep -q "::$target\""; then
    echo "  SST state: removing $target"
    pnpm exec sst state remove "$target" --stage "$STAGE"
  else
    echo "  SST state: $target not tracked (skip)"
  fi
done

echo "Device-runtime orphan cleanup complete. Run: pnpm exec sst deploy --stage $STAGE"
