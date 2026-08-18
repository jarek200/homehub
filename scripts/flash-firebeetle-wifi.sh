#!/usr/bin/env bash
# Flash FireBeetle ESP32-E WiFi firmware (scan or connect).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${FIREBEETLE_PORT:-/dev/cu.wchusbserial10}"
FQBN="esp32:esp32:esp32"
MODE="${1:-scan}"

if ! command -v arduino-cli >/dev/null 2>&1; then
  echo "arduino-cli not found — run: brew install arduino-cli"
  exit 1
fi

if [[ ! -e "$PORT" ]]; then
  echo "Serial port not found: $PORT"
  echo "Available:"; ls /dev/cu.wch* /dev/cu.usb* 2>/dev/null || true
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

echo "Compiling $MODE firmware..."
arduino-cli compile --fqbn "$FQBN" "${EXTRA_FLAGS[@]}" "$SKETCH"
echo "Uploading to $PORT..."
arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$SKETCH"
echo "Done. Serial monitor: arduino-cli monitor -p $PORT -c baudrate=115200"
