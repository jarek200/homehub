#!/usr/bin/env bash
# Deploy the MQTT device runtime to the Raspberry Pi over SSH (replaces Lightsail).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PI_HOST="${HOMEHUB_PI_HOST:-pi}"
REMOTE_DIR="${HOMEHUB_PI_DIR:-homehub-device-simulator}"

# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"

STAGE="${SST_STAGE:-}"
if [[ -z "$STAGE" ]]; then
  STAGE="$(homehub_personal_stage)"
fi
export SST_STAGE="$STAGE"

cd "$ROOT"
homehub_aws_stage_env "$STAGE"
homehub_aws_check_auth

echo "Deploying device runtime to ${PI_HOST} (stage=$STAGE, profile=${AWS_PROFILE:-default}, region=$AWS_REGION)"

eval "$(
  pnpm exec sst shell --stage "$STAGE" -- node --input-type=module -e "
import { Resource } from 'sst';
const table = Resource.AppTable?.name;
const queue = Resource.SimulatorEvents?.url;
if (!table || !queue) {
  console.error('Missing AppTable or SimulatorEvents — deploy the stack first (pnpm dev or pnpm deploy:int)');
  process.exit(1);
}
console.log('export TABLE_NAME=' + JSON.stringify(table));
console.log('export SQS_QUEUE_URL=' + JSON.stringify(queue));
"
)"

ACCESS_KEY_ID="$(aws ssm get-parameter --name "/homehub/${STAGE}/simulator/access-key-id" --region "$AWS_REGION" --query Parameter.Value --output text)"
SECRET_ACCESS_KEY="$(aws ssm get-parameter --name "/homehub/${STAGE}/simulator/secret-access-key" --with-decryption --region "$AWS_REGION" --query Parameter.Value --output text)"
IOT_HOST="$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --region "$AWS_REGION" --query endpointAddress --output text)"
IOT_ENDPOINT="https://${IOT_HOST}"
SNAPSHOT_BUCKET="${SNAPSHOT_BUCKET:-homehub-snapshots-${STAGE}}"

wait_for_ssh() {
  echo "Waiting for SSH on ${PI_HOST}..."
  for _ in $(seq 1 60); do
    if ssh -o BatchMode=yes -o ConnectTimeout=5 "$PI_HOST" 'true' >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  echo "Timed out waiting for ${PI_HOST}."
  return 1
}

wait_for_ssh

NEED_REBOOT="$(
  ssh "$PI_HOST" bash -s <<'REMOTE'
set -euo pipefail
need_reboot=0

if [[ ! -e /dev/i2c-1 ]]; then
  echo "Enabling GPIO I2C..." >&2
  sudo raspi-config nonint do_i2c 0
  CONFIG="/boot/firmware/config.txt"
  if [[ -f "$CONFIG" ]]; then
    if grep -q '^#dtparam=i2c_arm=on' "$CONFIG"; then
      sudo sed -i 's/^#dtparam=i2c_arm=on/dtparam=i2c_arm=on/' "$CONFIG"
    elif ! grep -q '^dtparam=i2c_arm=on' "$CONFIG"; then
      echo 'dtparam=i2c_arm=on' | sudo tee -a "$CONFIG" >/dev/null
    fi
  fi
  need_reboot=1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..." >&2
  curl -fsSL https://get.docker.com | sudo sh >&2
fi

if ! sudo docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin is missing after Docker install." >&2
  exit 1
fi

sudo usermod -aG docker "$USER" 2>/dev/null || true
sudo usermod -aG i2c "$USER" 2>/dev/null || true

printf '%s\n' "$need_reboot"
REMOTE
)"

if [[ "$NEED_REBOOT" == "1" ]]; then
  echo "GPIO I2C enabled — rebooting ${PI_HOST}."
  ssh "$PI_HOST" 'sudo reboot' || true
  sleep 8
  wait_for_ssh
fi

echo "Syncing packages/device-simulator to ${PI_HOST}:~/${REMOTE_DIR}/"
rsync -az --delete \
  --exclude '.venv/' \
  --exclude '__pycache__/' \
  --exclude '.env' \
  --exclude '.mypy_cache/' \
  "$ROOT/packages/device-simulator/" \
  "${PI_HOST}:${REMOTE_DIR}/"

# Write .env on the Pi without printing secrets.
ssh "$PI_HOST" bash -s <<REMOTE
set -euo pipefail
umask 077
cat > "\$HOME/${REMOTE_DIR}/.env" <<EOF
TABLE_NAME=${TABLE_NAME}
SQS_QUEUE_URL=${SQS_QUEUE_URL}
AWS_REGION=${AWS_REGION}
AWS_DEFAULT_REGION=${AWS_REGION}
AWS_ACCESS_KEY_ID=${ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${SECRET_ACCESS_KEY}
IOT_ENDPOINT=${IOT_ENDPOINT}
SNAPSHOT_BUCKET=${SNAPSHOT_BUCKET}
CERT_DIR=/tmp/certs
I2C_BUS=1
PAN_CHANNEL=0
TILT_CHANNEL=1
EOF
REMOTE

echo "Building and starting docker compose on ${PI_HOST}..."
ssh "$PI_HOST" bash -s <<REMOTE
set -euo pipefail
cd "\$HOME/${REMOTE_DIR}"
sudo docker compose -f docker-compose.pi.yml --env-file .env up -d --build
sudo docker compose -f docker-compose.pi.yml ps
REMOTE

echo "Device runtime is up on ${PI_HOST}."
echo "Register a camera in the HomeHub UI; the Pi container will receive DEVICE_READY over SQS."
