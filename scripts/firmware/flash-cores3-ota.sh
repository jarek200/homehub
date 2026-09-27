#!/usr/bin/env bash
# Build the CoreS3 controller image and start HTTPS OTA over AWS IoT.
# The board must already be running the OTA-capable A/B image (one USB flash).
# Usage: SST_STAGE=int bash scripts/firmware/flash-cores3-ota.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"

DEVICE_ID="${CORES3_DEVICE_ID:-cores3-gateway}"
CONTROLLER="${ESP_MATTER_CONTROLLER:-$HOME/esp/esp-matter/examples/controller}"
export SST_STAGE="${SST_STAGE:-int}"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

homehub_aws_force_stage_profile "$SST_STAGE"
homehub_aws_stage_env "$SST_STAGE"
homehub_aws_check_auth

SST_STAGE="$SST_STAGE" bash "$ROOT/scripts/provisioning/provision-cores3-iot.sh" --no-flash

PYTHON312="$(command -v python3.12 || true)"
if [[ -z "$PYTHON312" ]]; then
  echo "python3.12 is required for ESP-IDF 5.4"
  exit 1
fi
IDF_PYTHON_SHIM="${TMPDIR:-/tmp}/homehub-idf-python"
mkdir -p "$IDF_PYTHON_SHIM"
ln -sf "$PYTHON312" "$IDF_PYTHON_SHIM/python3"
export PATH="$IDF_PYTHON_SHIM:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export IDF_PATH="${IDF_PATH:-$HOME/esp/esp-idf}"
export ESP_MATTER_PATH="${ESP_MATTER_PATH:-$HOME/esp/esp-matter}"
# shellcheck disable=SC1091
. "${IDF_PATH}/export.sh"

cd "$CONTROLLER"
echo "Building CoreS3 controller image"
idf.py build
BIN="${CONTROLLER}/build/controller.bin"
if [[ ! -f "$BIN" ]]; then
  echo "Build did not produce ${BIN}"
  exit 1
fi

export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${PATH:-}"
homehub_aws_stage_env "$SST_STAGE"
uv run --directory "$ROOT/services/api" python "$ROOT/scripts/firmware/flash-cores3-ota.py" \
  --bin "$BIN" \
  --device-id "$DEVICE_ID" \
  --stage "$SST_STAGE"
echo "OTA command sent. Watch the CoreS3 for homehub_ota: Starting HTTPS OTA"
