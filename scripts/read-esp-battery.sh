#!/usr/bin/env bash
# Read FireBeetle battery voltage over HTTP (requires FIREBEETLE_BATTERY firmware).
# Usage: bash scripts/read-esp-battery.sh firebeetle-1|firebeetle-2
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/esp-devices.sh
source "$ROOT/scripts/lib/esp-devices.sh"

ALIAS="${1:-firebeetle-1}"
esp_lookup_device "$ALIAS"

if [[ "$ESP_DEVICE_BOARD" != "esp32" ]]; then
  echo "Battery reporting is only enabled on FireBeetle boards."
  exit 1
fi

if ! ip="$(esp_find_ip_for_mac "$ESP_DEVICE_MAC")"; then
  echo "Device $ALIAS not found on LAN."
  exit 1
fi

curl -sf "http://${ip}/battery" | python3 -m json.tool
