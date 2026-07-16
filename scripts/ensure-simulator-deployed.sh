#!/usr/bin/env bash
# Ensure the Lightsail device simulator is built and deployed (int/prod only).
# Personal sst dev stages exit immediately — use pnpm dev:simulator instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${SST_STAGE:-int}"
WAIT_FOR_STACK="${1:-}"

cd "$ROOT"

# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"
homehub_aws_stage_env "$STAGE"

if [[ "${HOMEHUB_SKIP_SIMULATOR:-}" == "true" ]]; then
  exit 0
fi

if [[ "$STAGE" != "int" && "$STAGE" != "prod" ]]; then
  echo "Skipping Lightsail simulator deploy for personal stage '$STAGE' (use pnpm dev:simulator)."
  exit 0
fi

if ! homehub_aws_check_auth; then
  exit 0
fi

REPO_NAME="homehub-device-simulator-${STAGE}"
SERVICE_NAME="homehub-${STAGE}-simulator"

wait_for_ecr() {
  local attempts=0
  local max_attempts=90
  while (( attempts < max_attempts )); do
    if aws ecr describe-repositories --repository-names "$REPO_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 10
  done
  echo "Timed out waiting for ECR repository $REPO_NAME (is sst dev / deploy running?)"
  return 1
}

wait_for_container_service() {
  local attempts=0
  local max_attempts=90
  while (( attempts < max_attempts )); do
    if aws lightsail get-container-services --region "$AWS_REGION" --query "containerServices[?containerServiceName=='${SERVICE_NAME}'].containerServiceName" --output text 2>/dev/null | grep -q "$SERVICE_NAME"; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 10
  done
  echo "Timed out waiting for Lightsail container service $SERVICE_NAME"
  return 1
}

if [[ "$WAIT_FOR_STACK" == "--wait-for-stack" ]]; then
  echo "Waiting for device simulator infrastructure on stage $STAGE ($AWS_REGION)..."
  wait_for_ecr || exit 0
  wait_for_container_service || exit 0
fi

if ! aws ecr describe-repositories --repository-names "$REPO_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "Device simulator ECR not ready yet — run 'pnpm simulator:deploy' after the stack is up."
  exit 0
fi

if ! aws lightsail get-container-services --region "$AWS_REGION" --query "containerServices[?containerServiceName=='${SERVICE_NAME}'].containerServiceName" --output text 2>/dev/null | grep -q "$SERVICE_NAME"; then
  echo "Lightsail container service not ready yet — run 'pnpm simulator:deploy' after the stack is up."
  exit 0
fi

if [[ "${HOMEHUB_FORCE_SIMULATOR_DEPLOY:-}" != "true" ]]; then
  STATE="$(aws lightsail get-container-service-deployments \
    --region "$AWS_REGION" \
    --service-name "$SERVICE_NAME" \
    --query 'deployments[0].state' \
    --output text 2>/dev/null || echo "NONE")"
  if [[ "$STATE" == "ACTIVE" ]]; then
    if aws ecr describe-images --repository-name "$REPO_NAME" --region "$AWS_REGION" --image-ids imageTag=latest >/dev/null 2>&1; then
      echo "Device simulator already ACTIVE on Lightsail (stage=$STAGE, region=$AWS_REGION). Set HOMEHUB_FORCE_SIMULATOR_DEPLOY=true to redeploy."
      exit 0
    fi
  fi
  # ECR has an image but Lightsail has no ACTIVE deployment — deploy from ECR without Docker.
fi

bash "$ROOT/scripts/deploy-simulator.sh"
