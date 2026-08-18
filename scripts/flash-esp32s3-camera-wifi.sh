#!/usr/bin/env bash
# Flash ESP32-S3 AI Camera (DFR1154) WiFi firmware (scan or connect).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${ESP32S3_PORT:-/dev/cu.usbmodem101}"
FQBN="esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc"
MODE="${1:-scan}"

if ! command -v arduino-cli >/dev/null 2>&1; then
  echo "arduino-cli not found — run: brew install arduino-cli"
  exit 1
fi

if [[ ! -e "$PORT" ]]; then
  echo "Serial port not found: $PORT"
  echo "Available:"; ls /dev/cu.usbmodem* 2>/dev/null || true
  exit 1
fi

case "$MODE" in
  scan)
    SKETCH="$ROOT/packages/firebeetle-firmware/wifi-scan"
    EXTRA_FLAGS=()
    ;;
  connect)
    SSID="${WIFI_SSID:-}"
    PASS="${WIFI_PASSWORD:-}"
    if [[ -z "$SSID" || -z "$PASS" ]]; then
      echo "Usage: WIFI_SSID='YourNetwork' WIFI_PASSWORD='secret' $0 connect"
      exit 1
    fi
    SKETCH="$ROOT/packages/firebeetle-firmware/wifi-connect"
    EXTRA_FLAGS=(
      --build-property "build.extra_flags=-DWIFI_SSID=\"$SSID\" -DWIFI_PASSWORD=\"$PASS\""
    )
    ;;
  *)
    echo "Usage: $0 [scan|connect]"
    exit 1
    ;;
esac

echo "Compiling $MODE firmware for ESP32-S3..."
arduino-cli compile --fqbn "$FQBN" "${EXTRA_FLAGS[@]}" "$SKETCH"
echo "Uploading to $PORT..."
arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$SKETCH"
echo "Done. Serial monitor: arduino-cli monitor -p $PORT -c baudrate=115200"
