#!/usr/bin/env bash
# USB flash OTA-capable firmware to a registered HomeHub ESP device.
# Usage: bash scripts/firmware/flash-esp-usb.sh timer-cam-f
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/esp-devices.sh
source "$ROOT/scripts/lib/esp-devices.sh"

ALIAS="${1:-}"
if [[ -z "$ALIAS" ]]; then
  echo "Usage: $0 <device-alias> [sketch]"
  echo "Sketch: timer-camera-f"
  echo "Devices:"
  "$GREP" -E '^[^#]' "$ESP_DEVICES_CONF" | cut -d'|' -f1
  exit 1
fi

esp_require_tools
esp_require_wifi_creds
esp_require_ota_password
esp_lookup_device "$ALIAS"

SKETCH="${2:-$(esp_default_sketch_for_board "$ESP_DEVICE_BOARD")}"
export ESP_SKETCH="$SKETCH"

FQBN="$(esp_fqbn_for_board "$ESP_DEVICE_BOARD")"
PORT="${ESP_USB_PORT:-$(esp_default_usb_port "$ESP_DEVICE_BOARD")}"

if [[ ! -e "$PORT" ]]; then
  echo "Serial port not found: $PORT"
  echo "Available:"
  ls /dev/cu.wchusbserial* /dev/cu.usbmodem* /dev/cu.usbserial* 2>/dev/null || true
  exit 1
fi

BUILD_PATH="$(mktemp -d "${TMPDIR:-/tmp}/homehub-esp-usb.XXXXXX")"
trap 'rm -rf "$BUILD_PATH"' EXIT

echo "Device:   $ESP_DEVICE_ALIAS ($ESP_DEVICE_HOSTNAME)"
echo "Expected: $ESP_DEVICE_MAC"
echo "Board:    $FQBN"
echo "Port:     $PORT"
echo "Sketch:   $(esp_active_sketch)"
echo "Compiling OTA firmware..."
esp_compile_sketch "$FQBN" "$BUILD_PATH"
echo "Uploading via USB..."
upload_log="$(mktemp)"
if ! arduino-cli upload -p "$PORT" --fqbn "$FQBN" --input-dir "$BUILD_PATH" "$(esp_active_sketch)" 2>&1 | tee "$upload_log"; then
  rm -f "$upload_log"
  exit 1
fi
if /usr/bin/grep -q "MAC:" "$upload_log"; then
  detected_mac="$(/usr/bin/grep "MAC:" "$upload_log" | tail -1 | awk '{print $2}')"
  expected_norm="$(esp_normalize_mac "$ESP_DEVICE_MAC")"
  detected_norm="$(esp_normalize_mac "$detected_mac")"
  if [[ "$detected_norm" != "$expected_norm" ]]; then
    echo ""
    echo "WARNING: USB MAC ($detected_mac) does not match $ESP_DEVICE_ALIAS ($ESP_DEVICE_MAC)."
    echo "Re-run with the correct alias, e.g.: bash scripts/firmware/flash-esp-usb.sh <other-device>"
  fi
fi
rm -f "$upload_log"
echo "Done."
echo "Verify serial output shows MAC, IP, and 'Ready for OTA' before unplugging."
echo "Serial monitor: arduino-cli monitor -p $PORT -c baudrate=115200"
