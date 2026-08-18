#!/usr/bin/env bash
# Remove HomeHub resources created in the wrong AWS account (AWS_PROFILE=prod / 447733314898).
#
# Personal stages and int deploy to homehub-int (800309353529). Real prod is homehub-prod
# (570064632535). A stray AWS_PROFILE=prod can leave orphans in the prod SSO account.
#
# Usage:
#   CONFIRM_CLEANUP=true bash scripts/cleanup-prod-profile-orphans.sh
set -euo pipefail

if [[ "${CONFIRM_CLEANUP:-}" != "true" ]]; then
  echo "This deletes HomeHub int + personal-stage orphans from AWS_PROFILE=prod."
  echo "Run: CONFIRM_CLEANUP=true bash scripts/cleanup-prod-profile-orphans.sh"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"

export AWS_PROFILE="${AWS_PROFILE_PROD_SSO:-prod}"
homehub_aws_stage_env int
homehub_aws_check_auth

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if [[ "$ACCOUNT" == "570064632535" || "$ACCOUNT" == "800309353529" ]]; then
  echo "Refusing to run against homehub-prod or homehub-int account ($ACCOUNT)."
  exit 1
fi

REGION="${AWS_REGION:-eu-west-1}"
echo "Cleaning HomeHub orphans (account=$ACCOUNT, profile=$AWS_PROFILE, region=$REGION)"

delete_apigw() {
  aws apigatewayv2 get-apis --region "$REGION" \
    --query "Items[?contains(Name, 'homehub')].ApiId" --output text \
    | tr '\t' '\n' | while read -r api_id; do
      [[ -n "$api_id" ]] || continue
      echo "  API Gateway $api_id: deleting"
      aws apigatewayv2 delete-api --region "$REGION" --api-id "$api_id"
    done
}

delete_sqs() {
  aws sqs list-queues --region "$REGION" --queue-name-prefix homehub \
    --query 'QueueUrls[]' --output text 2>/dev/null \
    | tr '\t' '\n' | while read -r url; do
      [[ -n "$url" ]] || continue
      echo "  SQS $url: deleting"
      aws sqs delete-queue --region "$REGION" --queue-url "$url"
    done
}

delete_dynamodb() {
  aws dynamodb list-tables --region "$REGION" \
    --query "TableNames[?contains(@, 'homehub')]" --output text \
    | tr '\t' '\n' | while read -r table; do
      [[ -n "$table" ]] || continue
      echo "  DynamoDB $table: deleting"
      aws dynamodb delete-table --region "$REGION" --table-name "$table"
    done
}

delete_s3() {
  aws s3api list-buckets --query "Buckets[?contains(Name, 'homehub')].Name" --output text \
    | tr '\t' '\n' | while read -r bucket; do
      [[ -n "$bucket" ]] || continue
      echo "  S3 $bucket: deleting"
      aws s3 rb "s3://$bucket" --force
    done
}

delete_glue() {
  aws glue get-databases --region "$REGION" \
    --query "DatabaseList[?contains(Name, 'homehub')].Name" --output text \
    | tr '\t' '\n' | while read -r db; do
      [[ -n "$db" ]] || continue
      aws glue get-tables --region "$REGION" --database-name "$db" \
        --query 'TableList[].Name' --output text 2>/dev/null \
        | tr '\t' '\n' | while read -r table; do
          [[ -n "$table" ]] || continue
          echo "  Glue table $db.$table: deleting"
          aws glue delete-table --region "$REGION" --database-name "$db" --name "$table"
        done
      echo "  Glue database $db: deleting"
      aws glue delete-database --region "$REGION" --name "$db"
    done
}

delete_iot_policy() {
  aws iot list-policies --region "$REGION" \
    --query "policies[?contains(policyName, 'homehub')].policyName" --output text \
    | tr '\t' '\n' | while read -r policy; do
      [[ -n "$policy" ]] || continue
      echo "  IoT policy $policy: detaching targets"
      aws iot list-targets-for-policy --region "$REGION" --policy-name "$policy" \
        --query 'targets[]' --output text 2>/dev/null \
        | tr '\t' '\n' | while read -r target; do
          [[ -n "$target" ]] || continue
          aws iot detach-policy --region "$REGION" --policy-name "$policy" --target "$target"
        done
      echo "  IoT policy $policy: deleting"
      aws iot delete-policy --region "$REGION" --policy-name "$policy"
    done
}

delete_iam_user() {
  local user="$1"
  if ! aws iam get-user --user-name "$user" >/dev/null 2>&1; then
    return 0
  fi
  echo "  IAM user $user: deleting"
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
  aws iam list-attached-user-policies --user-name "$user" \
    --query 'AttachedPolicies[].PolicyArn' --output text \
    | tr '\t' '\n' | while read -r arn; do
      [[ -n "$arn" ]] && aws iam detach-user-policy --user-name "$user" --policy-arn "$arn"
    done
  aws iam delete-user --user-name "$user"
}

delete_log_groups() {
  aws logs describe-log-groups --region "$REGION" --log-group-name-prefix /aws/lambda/homehub \
    --query 'logGroups[].logGroupName' --output text \
    | tr '\t' '\n' | while read -r group; do
      [[ -n "$group" ]] || continue
      echo "  Log group $group: deleting"
      aws logs delete-log-group --region "$REGION" --log-group-name "$group"
    done
}

echo "Deleting API Gateway..."
delete_apigw
echo "Deleting SQS..."
delete_sqs
echo "Deleting DynamoDB..."
delete_dynamodb
echo "Deleting S3..."
delete_s3
echo "Deleting Glue..."
delete_glue
echo "Deleting IoT policies..."
delete_iot_policy
echo "Deleting IAM users..."
delete_iam_user homehub-int-device-simulator
delete_iam_user homehub-jarekwyprzal-device-simulator
echo "Deleting CloudWatch log groups..."
delete_log_groups

echo ""
echo "Cleanup complete for account $ACCOUNT."
echo "Verify: AWS_PROFILE=$AWS_PROFILE aws s3 ls | grep homehub || echo 'No homehub S3 buckets left'"
