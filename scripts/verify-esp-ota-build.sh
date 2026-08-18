#!/usr/bin/env bash
# Verify OTA firmware compiles for all registered device board types.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/esp-devices.sh
source "$ROOT/scripts/lib/esp-devices.sh"

esp_require_tools
esp_require_wifi_creds
esp_require_ota_password

declare -A seen_boards=()
while IFS='|' read -r alias board hostname mac; do
  [[ "$alias" =~ ^# ]] && continue
  [[ -z "$alias" ]] && continue
  if [[ -n "${seen_boards[$board]:-}" ]]; then
    continue
  fi
  seen_boards[$board]=1
  ESP_DEVICE_ALIAS="$alias"
  ESP_DEVICE_BOARD="$board"
  ESP_DEVICE_HOSTNAME="$hostname"
  ESP_DEVICE_MAC="$mac"
  fqbn="$(esp_fqbn_for_board "$board")"
  build_path="$(mktemp -d "${TMPDIR:-/tmp}/homehub-esp-verify.${board}.XXXXXX")"
  echo "Compiling for $board ($fqbn)..."
  esp_compile_sketch "$fqbn" "$build_path"
  rm -rf "$build_path"
done < "$ESP_DEVICES_CONF"

echo "All board types compile successfully."
