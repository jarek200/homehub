#!/usr/bin/env bash
# Remove device-simulator AWS resources left behind after a failed deploy.
#
# Use when sst deploy fails with EntityAlreadyExists for simulator IAM/ECR/etc.
# Safe to re-run; no-ops when resources are absent.
#
# Does NOT touch resources that sst remove would manage — only known simulator
# orphans that block a clean re-create (IAM user, simulator SSM params).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${1:-int}"

if [[ "$STAGE" != "int" && "$STAGE" != "prod" ]]; then
  echo "Simulator orphans are only cleaned for int/prod (got stage=$STAGE)."
  exit 1
fi

# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"
homehub_aws_stage_env "$STAGE"
homehub_aws_check_auth

USER_NAME="homehub-${STAGE}-device-simulator"
SSM_KEY_ID="/homehub/${STAGE}/simulator/access-key-id"
SSM_SECRET="/homehub/${STAGE}/simulator/secret-access-key"

echo "Cleaning simulator orphans (stage=$STAGE, profile=${AWS_PROFILE:-default}, region=$AWS_REGION)"

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

delete_iam_user "$USER_NAME"
delete_ssm_param "$SSM_KEY_ID"
delete_ssm_param "$SSM_SECRET"

echo "Removing simulator IAM/SSM resources from SST state (if tracked)..."
cd "$ROOT"
for target in \
  DeviceSimulatorSecretAccessKey \
  DeviceSimulatorAccessKeyId \
  DeviceSimulatorUserPolicy \
  DeviceSimulatorAccessKey \
  DeviceSimulatorUser; do
  if pnpm exec sst state export --stage "$STAGE" 2>/dev/null | grep -q "::$target\""; then
    echo "  SST state: removing $target"
    pnpm exec sst state remove "$target" --stage "$STAGE"
  else
    echo "  SST state: $target not tracked (skip)"
  fi
done

echo "Simulator orphan cleanup complete. Run: pnpm exec sst deploy --stage $STAGE"
