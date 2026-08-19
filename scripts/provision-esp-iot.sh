#!/usr/bin/env bash
# Provision AWS IoT credentials and cloud firmware onto a registered ESP device.
# Usage: SST_STAGE=int bash scripts/provision-esp-iot.sh <alias> <deviceId>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/esp-devices.sh
source "$ROOT/scripts/lib/esp-devices.sh"
# shellcheck source=lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"

ALIAS="${1:-firebeetle-1}"
DEVICE_ID="${2:-}"
export SST_STAGE="${SST_STAGE:-int}"
case "$SST_STAGE" in
  prod) export AWS_PROFILE="${AWS_PROFILE_PROD:-homehub-prod}" ;;
  int) export AWS_PROFILE="${AWS_PROFILE_INT:-homehub-int}" ;;
esac
TMP_DIR=""
GENERATED_DIR=""
TARGET_SKETCH=""

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
  if [[ -n "$GENERATED_DIR" ]]; then
    rm -f "${GENERATED_DIR}/iot_config.h"
    rmdir "${GENERATED_DIR}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -z "$DEVICE_ID" ]]; then
  echo "Usage: SST_STAGE=int bash scripts/provision-esp-iot.sh <esp-alias> <deviceId>"
  exit 1
fi

esp_lookup_device "$ALIAS"
case "$ESP_DEVICE_BOARD" in
  esp32)
    TARGET_SKETCH="environmental-sensor-ota"
    EXPECTED_DEVICE_TYPE="environmental-sensor"
    ;;
  esp32s3)
    TARGET_SKETCH="esp32s3-camera-cloud"
    EXPECTED_DEVICE_TYPE="camera"
    ;;
  *)
    echo "No HomeHub cloud firmware configured for board ${ESP_DEVICE_BOARD}."
    exit 1
    ;;
esac
GENERATED_DIR="${ROOT}/packages/firebeetle-firmware/${TARGET_SKETCH}/generated"
esp_require_wifi_creds
esp_require_ota_password
esp_require_tools
homehub_aws_stage_env "${SST_STAGE:-int}"
homehub_aws_check_auth

TABLE_NAME="${HOMEHUB_TABLE_NAME:-}"
if [[ -z "$TABLE_NAME" ]]; then
  TABLE_NAME="$(aws dynamodb list-tables --query "TableNames[?contains(@, 'homehub-${SST_STAGE}') && contains(@, 'AppTable')]" --output text | awk '{print $1}')"
fi
if [[ -z "$TABLE_NAME" || "$TABLE_NAME" == "None" ]]; then
  TABLE_NAME="$(cd "$ROOT" && AWS_PROFILE="${AWS_PROFILE:-}" pnpm exec sst shell --stage "$SST_STAGE" -- node --input-type=module -e "
import { Resource } from 'sst';
const table = Resource.AppTable?.name;
if (!table) process.exit(1);
console.log(table);
" 2>/dev/null || true)"
fi
if [[ -z "$TABLE_NAME" || "$TABLE_NAME" == "None" ]]; then
  echo "Could not resolve DynamoDB table for stage ${SST_STAGE} (is the stack deployed?)"
  exit 1
fi

REGISTRY="$(aws dynamodb get-item \
  --table-name "$TABLE_NAME" \
  --key "{\"PK\":{\"S\":\"SIMULATOR\"},\"SK\":{\"S\":\"DEVICE#${DEVICE_ID}\"}}" \
  --output json)"
TENANT_PK="$(echo "$REGISTRY" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("Item",{}).get("tenantPk",{}).get("S","HUB#demo"))')"
THING_NAME="$(echo "$REGISTRY" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("Item",{}).get("thingName",{}).get("S",""))')"
HUB_ID="$(echo "$REGISTRY" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("Item",{}).get("hubId",{}).get("S","demo"))')"
if [[ -z "$THING_NAME" ]]; then
  echo "IoT registry for device ${DEVICE_ID} was not found in ${TABLE_NAME}."
  exit 1
fi

DEVICE_ITEM="$(aws dynamodb get-item \
  --table-name "$TABLE_NAME" \
  --key "{\"PK\":{\"S\":\"${TENANT_PK}\"},\"SK\":{\"S\":\"DEVICE#${DEVICE_ID}\"}}" \
  --output json 2>/dev/null || true)"
if [[ -z "$DEVICE_ITEM" || "$DEVICE_ITEM" == "null" ]]; then
  echo "Device ${DEVICE_ID} not found in ${TABLE_NAME} (tenant ${TENANT_PK})."
  exit 1
fi

LIFECYCLE="$(echo "$DEVICE_ITEM" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("Item",{}).get("lifecycleStatus",{}).get("S",""))')"
RUNTIME_KIND="$(echo "$DEVICE_ITEM" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("Item",{}).get("runtimeKind",{}).get("S","simulated"))')"
DEVICE_TYPE="$(echo "$DEVICE_ITEM" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("Item",{}).get("type",{}).get("S",""))')"
if [[ "$LIFECYCLE" != "READY" ]]; then
  echo "Device ${DEVICE_ID} lifecycle is ${LIFECYCLE}; wait until READY."
  exit 1
fi
if [[ "$RUNTIME_KIND" != "physical" ]]; then
  echo "Device ${DEVICE_ID} runtimeKind=${RUNTIME_KIND}; expected physical."
  exit 1
fi
if [[ "$DEVICE_TYPE" != "$EXPECTED_DEVICE_TYPE" ]]; then
  echo "Device ${DEVICE_ID} type=${DEVICE_TYPE}; ${ALIAS} requires ${EXPECTED_DEVICE_TYPE}."
  exit 1
fi

SSM_PREFIX="/homehub/devices/${DEVICE_ID}"
IOT_ENDPOINT="$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/homehub-iot.XXXXXX")"
chmod 700 "$TMP_DIR"
CERT_FILE="${TMP_DIR}/cert.pem"
KEY_FILE="${TMP_DIR}/key.pem"
CA_FILE="${TMP_DIR}/ca.pem"
HEADER_FILE="${TMP_DIR}/iot_config.h"

aws ssm get-parameter --name "${SSM_PREFIX}/cert" --with-decryption --query Parameter.Value --output text >"$CERT_FILE"
aws ssm get-parameter --name "${SSM_PREFIX}/key" --with-decryption --query Parameter.Value --output text >"$KEY_FILE"
aws ssm get-parameter --name "${SSM_PREFIX}/ca" --with-decryption --query Parameter.Value --output text >"$CA_FILE"
chmod 600 "$CERT_FILE" "$KEY_FILE" "$CA_FILE"

python3 - "$HEADER_FILE" "$IOT_ENDPOINT" "$DEVICE_ID" "$HUB_ID" "$THING_NAME" "$CERT_FILE" "$KEY_FILE" "$CA_FILE" <<'PY'
import pathlib
import sys

header, endpoint, device_id, hub_id, thing_name, cert_path, key_path, ca_path = sys.argv[1:9]

def pem_literal(path: str) -> str:
    return pathlib.Path(path).read_text().strip()

content = f"""#ifndef HOMEHUB_IOT_CONFIG_H
#define HOMEHUB_IOT_CONFIG_H

#define HOMEHUB_IOT_ENABLED 1
#define HOMEHUB_IOT_ENDPOINT "{endpoint}"
#define HOMEHUB_DEVICE_ID "{device_id}"
#define HOMEHUB_HUB_ID "{hub_id}"
#define HOMEHUB_THING_NAME "{thing_name}"

static const char HOMEHUB_AWS_ROOT_CA[] PROGMEM = R"HOMEHUB_EOF({pem_literal(ca_path)}
)HOMEHUB_EOF";

static const char HOMEHUB_DEVICE_CERT[] PROGMEM = R"HOMEHUB_EOF({pem_literal(cert_path)}
)HOMEHUB_EOF";

static const char HOMEHUB_DEVICE_KEY[] PROGMEM = R"HOMEHUB_EOF({pem_literal(key_path)}
)HOMEHUB_EOF";

#endif
"""
pathlib.Path(header).write_text(content)
PY

mkdir -p "$GENERATED_DIR"
install -m 600 "$HEADER_FILE" "${GENERATED_DIR}/iot_config.h"

arduino-cli lib install "ArduinoMqttClient" >/dev/null 2>&1 || true

export ESP_SKETCH="$TARGET_SKETCH"
export ESP_OTA_SKETCH="$TARGET_SKETCH"

flash_ok=0
if bash "$ROOT/scripts/flash-esp-ota.sh" "$ALIAS" "$TARGET_SKETCH"; then
  flash_ok=1
else
  echo "OTA flash failed. Trying USB if a serial port is present..."
  if bash "$ROOT/scripts/flash-esp-usb.sh" "$ALIAS" "$TARGET_SKETCH"; then
    flash_ok=1
  fi
fi

rm -f "${GENERATED_DIR}/iot_config.h"
rmdir "${GENERATED_DIR}" 2>/dev/null || true

if [[ "$flash_ok" -ne 1 ]]; then
  echo "Provisioning compiled credentials but flash failed."
  echo "For a sleeping sensor, enable maintenance mode and rerun after its next wake."
  echo "USB recovery: bash scripts/flash-esp-usb.sh ${ALIAS} ${TARGET_SKETCH}"
  exit 1
fi

echo "Provisioned and flashed ${ALIAS} for device ${DEVICE_ID} (${THING_NAME})."
