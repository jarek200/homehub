#!/usr/bin/env bash
# OTA flash OTA-capable firmware to a registered HomeHub ESP device (no USB).
# Usage: bash scripts/firmware/flash-esp-ota.sh timer-cam-f|all
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/esp-devices.sh
source "$ROOT/scripts/lib/esp-devices.sh"

TARGET="${1:-}"
SKETCH_OVERRIDE="${2:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <device-alias|all> [sketch]"
  echo "Sketch: timer-camera-f"
  echo "Devices:"
  "$GREP" -E '^[^#]' "$ESP_DEVICES_CONF" | cut -d'|' -f1
  exit 1
fi

esp_require_tools
esp_require_wifi_creds
esp_require_ota_password

flash_one() {
  local alias="$1"
  esp_lookup_device "$alias"
  export ESP_SKETCH="${SKETCH_OVERRIDE:-$(esp_default_sketch_for_board "$ESP_DEVICE_BOARD")}"
  local fqbn ip build_path
  fqbn="$(esp_fqbn_for_board "$ESP_DEVICE_BOARD")"

  if ! ip="$(esp_find_ip_for_mac "$ESP_DEVICE_MAC")"; then
    echo "Device $alias ($ESP_DEVICE_MAC) not found on LAN — is it powered and on Wi-Fi?"
    return 1
  fi

  build_path="$(mktemp -d "${TMPDIR:-/tmp}/homehub-esp-ota.${alias}.XXXXXX")"
  echo "Device: $alias ($ESP_DEVICE_HOSTNAME) @ $ip"
  esp_compile_sketch "$fqbn" "$build_path"
  esp_upload_ota "$fqbn" "$ip" "$build_path"
  rm -rf "$build_path"
}

if [[ "$TARGET" == "all" ]]; then
  failed=0
  while IFS='|' read -r alias _ _ _; do
    [[ "$alias" =~ ^# ]] && continue
    [[ -z "$alias" ]] && continue
    if ! flash_one "$alias"; then
      failed=1
    fi
  done < "$ESP_DEVICES_CONF"
  exit "$failed"
fi

flash_one "$TARGET"
