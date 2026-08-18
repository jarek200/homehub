#!/usr/bin/env bash
# Blink a FireBeetle onboard LED so you can tell boards apart.
# Usage: bash scripts/identify-esp-device.sh firebeetle-1|firebeetle-2 [seconds]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/esp-devices.sh
source "$ROOT/scripts/lib/esp-devices.sh"

ALIAS="${1:-}"
SECONDS="${2:-20}"
if [[ -z "$ALIAS" ]]; then
  echo "Usage: $0 <firebeetle-1|firebeetle-2> [seconds]"
  exit 1
fi

esp_lookup_device "$ALIAS"

if ! ip="$(esp_find_ip_for_mac "$ESP_DEVICE_MAC")"; then
  echo "Device $ALIAS not found on LAN."
  exit 1
fi

label="$(esp_device_label "$ALIAS")"
case "$ALIAS" in
  firebeetle-1) pattern="FAST blink (rapid flash)" ;;
  firebeetle-2) pattern="SLOW blink (long pulse)" ;;
  *) pattern="blink" ;;
esac

echo "Identifying $label ($ESP_DEVICE_HOSTNAME) @ $ip"
echo "Watch the onboard LED — $pattern for ${SECONDS}s"
echo ""

response="$(curl -sf "http://${ip}/identify?seconds=${SECONDS}")" || {
  echo "Identify request failed. Is environmental-sensor-ota firmware flashed?"
  exit 1
}

echo "$response" | python3 -m json.tool
echo ""
echo "Look at your FireBeetles now — only $label should be blinking."
