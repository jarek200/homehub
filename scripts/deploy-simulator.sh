#!/usr/bin/env bash
# Build, push, and deploy the device simulator to Lightsail Container Service.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${SST_STAGE:-int}"
IMAGE_TAG="${SIMULATOR_IMAGE_TAG:-latest}"

cd "$ROOT"

if [[ "${HOMEHUB_SKIP_SIMULATOR:-}" == "true" ]]; then
  echo "Skipping device simulator deploy (HOMEHUB_SKIP_SIMULATOR)."
  exit 0
fi

if [[ "$STAGE" != "int" && "$STAGE" != "prod" ]]; then
  echo "Device simulator Lightsail is only provisioned on int/prod (stage=$STAGE)."
  exit 0
fi

# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"
homehub_aws_stage_env "$STAGE"
homehub_aws_check_auth

REPO_NAME="homehub-device-simulator-${STAGE}"
SERVICE_NAME="homehub-${STAGE}-simulator"

echo "Deploying device simulator to Lightsail Container Service (stage=$STAGE, profile=${AWS_PROFILE:-default}, region=$AWS_REGION, tag=$IMAGE_TAG)"

ECR_ERR="$(aws ecr describe-repositories --repository-names "$REPO_NAME" --region "$AWS_REGION" 2>&1)" || {
  if echo "$ECR_ERR" | grep -qiE 'expired|credentials|Unauthorized|AccessDenied|InvalidClientTokenId'; then
    echo "$ECR_ERR"
    echo "AWS auth failed. Run: pnpm sso"
    exit 1
  fi
  echo "ECR repository $REPO_NAME not found in $AWS_REGION (profile=${AWS_PROFILE:-default})."
  echo "Deploy the stack first: pnpm exec sst deploy --stage $STAGE"
  exit 1
}

if ! aws lightsail get-container-services --region "$AWS_REGION" --query "containerServices[?containerServiceName=='${SERVICE_NAME}'].containerServiceName" --output text | grep -q "$SERVICE_NAME"; then
  echo "Lightsail container service $SERVICE_NAME not found in $AWS_REGION. Deploy the stack first: pnpm exec sst deploy --stage $STAGE"
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

eval "$(
  pnpm exec sst shell --stage "$STAGE" -- node --input-type=module -e "
import { Resource } from 'sst';
const table = Resource.AppTable?.name;
const queue = Resource.SimulatorEvents?.url;
if (!table || !queue) {
  console.error('Missing AppTable or SimulatorEvents');
  process.exit(1);
}
console.log('export TABLE_NAME=' + JSON.stringify(table));
console.log('export SQS_QUEUE_URL=' + JSON.stringify(queue));
"
)"

ACCESS_KEY_ID="$(aws ssm get-parameter --name "/homehub/${STAGE}/simulator/access-key-id" --region "$AWS_REGION" --query Parameter.Value --output text)"
SECRET_ACCESS_KEY="$(aws ssm get-parameter --name "/homehub/${STAGE}/simulator/secret-access-key" --with-decryption --region "$AWS_REGION" --query Parameter.Value --output text)"
IOT_HOST="$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --region "$AWS_REGION" --query endpointAddress --output text)"
export IOT_ENDPOINT="https://${IOT_HOST}"
export ACCESS_KEY_ID
export SECRET_ACCESS_KEY

IMAGE_EXISTS=false
if aws ecr describe-images \
  --repository-name "$REPO_NAME" \
  --region "$AWS_REGION" \
  --image-ids "imageTag=${IMAGE_TAG}" >/dev/null 2>&1; then
  IMAGE_EXISTS=true
fi

# Skip rebuild/redeploy when an image is already live, unless explicitly forced
# (CI sets HOMEHUB_FORCE_SIMULATOR_DEPLOY only when simulator-related paths change).
if [[ "${HOMEHUB_FORCE_SIMULATOR_DEPLOY:-}" != "true" && "${HOMEHUB_SIMULATOR_BUILD:-}" != "true" && "$IMAGE_EXISTS" == "true" ]]; then
  STATE="$(aws lightsail get-container-service-deployments \
    --region "$AWS_REGION" \
    --service-name "$SERVICE_NAME" \
    --query 'deployments[0].state' \
    --output text 2>/dev/null || echo "NONE")"
  if [[ "$STATE" == "ACTIVE" ]]; then
    echo "Lightsail simulator already ACTIVE on $SERVICE_NAME (ECR tag=$IMAGE_TAG) — skipping rebuild/redeploy."
    echo "Set HOMEHUB_FORCE_SIMULATOR_DEPLOY=true to rebuild and redeploy anyway."
    exit 0
  fi
fi

BUILD_IMAGE=false
if [[ "${HOMEHUB_SIMULATOR_BUILD:-}" == "true" || "${HOMEHUB_FORCE_SIMULATOR_DEPLOY:-}" == "true" ]]; then
  BUILD_IMAGE=true
elif [[ "$IMAGE_EXISTS" == "false" ]]; then
  BUILD_IMAGE=true
fi

if [[ "$BUILD_IMAGE" == "true" ]]; then
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running."
    if [[ "$IMAGE_EXISTS" == "true" ]]; then
      echo "An ECR image exists — redeploying without rebuild. Start Docker and set HOMEHUB_SIMULATOR_BUILD=true to push a new image."
      BUILD_IMAGE=false
    else
      echo "No image in ECR yet. Start Docker Desktop, then run: pnpm simulator:deploy"
      echo "Or push an image from CI and re-run pnpm dev."
      exit 1
    fi
  fi
fi

if [[ "$BUILD_IMAGE" == "true" ]]; then
  # Lightsail runs amd64 — build for linux/amd64 even on Apple Silicon Macs.
  DOCKER_PLATFORM="${HOMEHUB_DOCKER_PLATFORM:-linux/amd64}"
  echo "Building Docker image (platform=$DOCKER_PLATFORM)..."
  docker build --platform "$DOCKER_PLATFORM" -t "${ECR_URI}:${IMAGE_TAG}" "$ROOT/packages/device-simulator"

  echo "Pushing to ECR..."
  aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
  docker push "${ECR_URI}:${IMAGE_TAG}"

  if [[ "$IMAGE_TAG" != "latest" ]]; then
    docker tag "${ECR_URI}:${IMAGE_TAG}" "${ECR_URI}:latest"
    docker push "${ECR_URI}:latest"
  fi
else
  echo "Deploying existing ECR image ${ECR_URI}:${IMAGE_TAG} (no local Docker build)."
fi

CONTAINERS_FILE="$(mktemp)"
trap 'rm -f "$CONTAINERS_FILE"' EXIT

python3 - <<PY
import json
import os

containers = {
    "simulator": {
        "image": "${ECR_URI}:${IMAGE_TAG}",
        "environment": {
            "TABLE_NAME": os.environ["TABLE_NAME"],
            "SQS_QUEUE_URL": os.environ["SQS_QUEUE_URL"],
            "AWS_REGION": os.environ["AWS_REGION"],
            "IOT_ENDPOINT": os.environ["IOT_ENDPOINT"],
            "AWS_ACCESS_KEY_ID": os.environ["ACCESS_KEY_ID"],
            "AWS_SECRET_ACCESS_KEY": os.environ["SECRET_ACCESS_KEY"],
            "CERT_DIR": "/tmp/certs",
        },
    }
}
with open("${CONTAINERS_FILE}", "w", encoding="utf-8") as f:
    json.dump(containers, f)
PY

echo "Creating Lightsail container deployment on $SERVICE_NAME..."
# Do not print the full API response — it includes AWS_SECRET_ACCESS_KEY in env.
DEPLOY_VERSION="$(
  aws lightsail create-container-service-deployment \
    --region "$AWS_REGION" \
    --service-name "$SERVICE_NAME" \
    --containers "file://${CONTAINERS_FILE}" \
    --query 'containerService.nextDeployment.version' \
    --output text
)"
echo "Lightsail deployment version ${DEPLOY_VERSION} created (waiting for ACTIVE)..."

echo "Waiting for deployment to become ACTIVE..."
for _ in $(seq 1 60); do
  STATE="$(aws lightsail get-container-service-deployments \
    --region "$AWS_REGION" \
    --service-name "$SERVICE_NAME" \
    --query 'deployments[0].state' \
    --output text 2>/dev/null || echo "UNKNOWN")"
  if [[ "$STATE" == "ACTIVE" ]]; then
    echo "Device simulator deployment is ACTIVE."
    exit 0
  fi
  if [[ "$STATE" == "FAILED" ]]; then
    echo "Device simulator deployment FAILED (version ${DEPLOY_VERSION}). Recent container logs:"
    aws lightsail get-container-log \
      --region "$AWS_REGION" \
      --service-name "$SERVICE_NAME" \
      --container-name simulator \
      --query 'logEvents[-20:].message' \
      --output text 2>/dev/null || true
    exit 1
  fi
  sleep 10
done

echo "Timed out waiting for deployment (last state: $STATE)."
exit 1
