#!/usr/bin/env bash
# Provision AWS IoT credentials onto the CoreS3 Matter controller firmware.
# Usage: SST_STAGE=int bash scripts/provisioning/provision-cores3-iot.sh [--no-flash]
# Does not erase-flash (Thread + Wi-Fi NVS must survive).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"

FLASH=1
DEVICE_ID="${CORES3_DEVICE_ID:-cores3-gateway}"
PORT="${CORES3_PORT:-/dev/cu.usbmodem101}"
CONTROLLER="${ESP_MATTER_CONTROLLER:-$HOME/esp/esp-matter/examples/controller}"
export SST_STAGE="${SST_STAGE:-int}"

for arg in "$@"; do
  case "$arg" in
    --no-flash) FLASH=0 ;;
    --flash) FLASH=1 ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: SST_STAGE=int bash scripts/provisioning/provision-cores3-iot.sh [--no-flash]"
      exit 1
      ;;
  esac
done

homehub_aws_force_stage_profile "$SST_STAGE"
homehub_aws_stage_env "$SST_STAGE"
homehub_aws_check_auth

TABLE_NAME="$(homehub_app_table "$SST_STAGE" || true)"
export TABLE_NAME
if [[ -z "${TABLE_NAME}" || "${TABLE_NAME}" == "None" ]]; then
  echo "Could not resolve TABLE_NAME for stage ${SST_STAGE}."
  exit 1
fi

HEADER_REPO="${ROOT}/firmware/cores3-gateway/components/homehub_aws/generated/iot_config.h"
uv run --directory "$ROOT/services/api" python "$ROOT/scripts/provisioning/provision-cores3-iot.py" \
  --device-id "$DEVICE_ID" \
  --stage "$SST_STAGE" \
  --header "$HEADER_REPO"

if [[ ! -d "$CONTROLLER" ]]; then
  echo "esp-matter controller not found at ${CONTROLLER}."
  echo "Set ESP_MATTER_CONTROLLER or install esp-matter under ~/esp/esp-matter."
  exit 1
fi

COMPONENT="${CONTROLLER}/components/homehub_aws"
OTA_COMPONENT="${CONTROLLER}/components/homehub_ota"
STATUS_COMPONENT="${CONTROLLER}/components/homehub_status"
mkdir -p "${COMPONENT}/include" "${COMPONENT}/generated" "${OTA_COMPONENT}/include" \
  "${STATUS_COMPONENT}/include"
install -m 644 "$ROOT/firmware/cores3-gateway/components/homehub_aws/CMakeLists.txt" \
  "${COMPONENT}/CMakeLists.txt"
install -m 644 "$ROOT/firmware/cores3-gateway/components/homehub_aws/homehub_aws.cpp" \
  "${COMPONENT}/homehub_aws.cpp"
install -m 644 "$ROOT/firmware/cores3-gateway/components/homehub_aws/include/homehub_aws.h" \
  "${COMPONENT}/include/homehub_aws.h"
install -m 600 "$HEADER_REPO" "${COMPONENT}/generated/iot_config.h"
install -m 644 "$ROOT/firmware/cores3-gateway/components/homehub_ota/CMakeLists.txt" \
  "${OTA_COMPONENT}/CMakeLists.txt"
install -m 644 "$ROOT/firmware/cores3-gateway/components/homehub_ota/homehub_ota.cpp" \
  "${OTA_COMPONENT}/homehub_ota.cpp"
install -m 644 "$ROOT/firmware/cores3-gateway/components/homehub_ota/include/homehub_ota.h" \
  "${OTA_COMPONENT}/include/homehub_ota.h"
install -m 644 "$ROOT/firmware/cores3-gateway/components/homehub_status/CMakeLists.txt" \
  "${STATUS_COMPONENT}/CMakeLists.txt"
install -m 644 "$ROOT/firmware/cores3-gateway/components/homehub_status/homehub_status.cpp" \
  "${STATUS_COMPONENT}/homehub_status.cpp"
install -m 644 "$ROOT/firmware/cores3-gateway/components/homehub_status/include/homehub_status.h" \
  "${STATUS_COMPONENT}/include/homehub_status.h"
install -m 644 "$ROOT/firmware/cores3-gateway/components/homehub_aws/include/homehub_aws.h" "${CONTROLLER}/main/homehub_aws.h"
install -m 644 "$ROOT/firmware/cores3-gateway/main/include/homehub_matter.h" "${CONTROLLER}/main/homehub_matter.h"
install -m 644 "$ROOT/firmware/cores3-gateway/main/homehub_matter.cpp" "${CONTROLLER}/main/homehub_matter.cpp"
install -m 644 "$ROOT/firmware/cores3-gateway/main/app_main.cpp" "${CONTROLLER}/main/app_main.cpp"
install -m 644 "$ROOT/firmware/cores3-gateway/main/esp_ot_config.h" "${CONTROLLER}/main/esp_ot_config.h"
install -m 644 "$ROOT/firmware/cores3-gateway/overlays/controller_main_CMakeLists.txt" \
  "${CONTROLLER}/main/CMakeLists.txt"
mkdir -p "${CONTROLLER}/paa_cert"
install -m 644 "$ROOT"/firmware/cores3-gateway/paa_cert/*.der "${CONTROLLER}/paa_cert/"

# The PAA store must mount the paa_cert SPIFFS partition, not the first one (rcp_fw).
ESP_MATTER_ROOT="${ESP_MATTER_PATH:-$(cd "${CONTROLLER}/../.." && pwd)}"
TRUST_STORE_PATCH="$ROOT/firmware/cores3-gateway/overlays/esp_matter_attestation_trust_store.patch"
if git -C "$ESP_MATTER_ROOT" apply --reverse --check "$TRUST_STORE_PATCH" 2>/dev/null; then
  echo "esp-matter trust store patch already applied"
elif git -C "$ESP_MATTER_ROOT" apply --check "$TRUST_STORE_PATCH" 2>/dev/null; then
  git -C "$ESP_MATTER_ROOT" apply "$TRUST_STORE_PATCH"
  echo "Applied esp-matter trust store patch"
else
  echo "Cannot apply ${TRUST_STORE_PATCH} to ${ESP_MATTER_ROOT} (expected esp-matter release/v1.4)."
  exit 1
fi
install -m 644 "$ROOT/firmware/cores3-gateway/sdkconfig.defaults.cores3" \
  "${CONTROLLER}/sdkconfig.defaults.cores3"
# Keep sdkconfig filename partitions_br.csv; overlay the A/B 16 MB table.
install -m 644 "$ROOT/firmware/cores3-gateway/partitions_16mb.csv" \
  "${CONTROLLER}/partitions_br.csv"
rm -f "${CONTROLLER}/main/homehub_aws.cpp" "${CONTROLLER}/main/generated/iot_config.h"

if [[ -f "${CONTROLLER}/sdkconfig" ]]; then
  python3 - "${CONTROLLER}/sdkconfig" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
text = text.replace("CONFIG_MDNS_MAX_SERVICES=10", "CONFIG_MDNS_MAX_SERVICES=32")
text = text.replace(
    "# CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE is not set",
    "CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y",
)
if "CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y" not in text:
    text += "\nCONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y\n"
path.write_text(text)
PY
fi

echo "Overlaid HomeHub AWS IoT sources into ${CONTROLLER}"

if [[ "$FLASH" -ne 1 ]]; then
  echo "Skipping flash (--no-flash). Header and overlay are ready."
  exit 0
fi

if [[ ! -e "$PORT" ]]; then
  found="$(ls /dev/cu.usbmodem* 2>/dev/null | head -n 1 || true)"
  if [[ -n "$found" ]]; then
    PORT="$found"
  else
    echo "CoreS3 serial port not found. Press POWER, then rerun."
    echo "Expected ${CORES3_PORT:-/dev/cu.usbmodem101}."
    exit 1
  fi
fi

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export IDF_PATH="${IDF_PATH:-$HOME/esp/esp-idf}"
export ESP_MATTER_PATH="${ESP_MATTER_PATH:-$HOME/esp/esp-matter}"
# shellcheck disable=SC1091
. "${IDF_PATH}/export.sh"

cd "$CONTROLLER"
echo "Building and flashing ${PORT} (no erase)"
idf.py -p "$PORT" build flash
echo "Flashed CoreS3 AWS IoT firmware for ${DEVICE_ID}."
echo "Watch for: homehub_aws: MQTT connected to AWS IoT"
