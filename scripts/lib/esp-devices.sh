#!/usr/bin/env bash
# Shared helpers for HomeHub ESP32 USB and OTA flash scripts.
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_REPO_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
ESP_DEVICES_CONF="${ESP_DEVICES_CONF:-$_REPO_ROOT/packages/firebeetle-firmware/devices.conf}"
ESP_FIRMWARE_DIR="${ESP_FIRMWARE_DIR:-$_REPO_ROOT/packages/firebeetle-firmware}"

esp_resolve_sketch() {
  local sketch="${1:-${ESP_SKETCH:-wifi-connect-ota}}"
  case "$sketch" in
    wifi-connect-ota | environmental-sensor-ota | esp32s3-camera-cloud | wifi-connect | wifi-scan)
      echo "$ESP_FIRMWARE_DIR/$sketch"
      ;;
    /* | ./* | ../*)
      echo "$sketch"
      ;;
    *)
      echo "Unknown sketch: $sketch" >&2
      echo "Known sketches: wifi-connect-ota, environmental-sensor-ota, esp32s3-camera-cloud, wifi-connect, wifi-scan" >&2
      exit 1
      ;;
  esac
}

esp_active_sketch() {
  if [[ -n "${ESP_OTA_SKETCH:-}" ]]; then
    esp_resolve_sketch "$ESP_OTA_SKETCH"
    return
  fi
  esp_resolve_sketch "${ESP_SKETCH:-wifi-connect-ota}"
}

GREP="${GREP:-/usr/bin/grep}"

esp_require_tools() {
  if ! command -v arduino-cli >/dev/null 2>&1; then
    echo "arduino-cli not found — run: brew install arduino-cli"
    exit 1
  fi
}

esp_normalize_mac() {
  local mac="$1"
  mac="$(echo "$mac" | tr '[:upper:]' '[:lower:]')"
  local IFS=':'
  local -a parts=()
  read -ra parts <<<"$mac"
  local out="" part
  for part in "${parts[@]}"; do
    part="${part//-}"
    if [[ ${#part} -eq 1 ]]; then
      part="0${part}"
    fi
    out+="${part}"
  done
  echo "$out"
}

esp_lookup_device() {
  local alias="$1"
  local line
  line="$("$GREP" -E "^${alias}\|" "$ESP_DEVICES_CONF" | head -1 || true)"
  if [[ -z "$line" ]]; then
    echo "Unknown device alias: $alias"
    echo "Known devices:"
    "$GREP" -E '^[^#]' "$ESP_DEVICES_CONF" | cut -d'|' -f1
    exit 1
  fi
  IFS='|' read -r ESP_DEVICE_ALIAS ESP_DEVICE_BOARD ESP_DEVICE_HOSTNAME ESP_DEVICE_MAC <<<"$line"
}

esp_fqbn_for_board() {
  case "$1" in
    esp32)
      echo "esp32:esp32:esp32:FlashSize=16M,PartitionScheme=min_spiffs"
      ;;
    esp32s3)
      # DFR1154: 16 MB flash + 8 MB OPI PSRAM — needs huge_app, not default_8MB.
      echo "esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc,FlashSize=16M,PartitionScheme=huge_app,PSRAM=opi,FlashMode=qio"
      ;;
    *)
      echo "Unsupported board type: $1" >&2
      exit 1
      ;;
  esac
}

esp_default_usb_port() {
  case "$1" in
    esp32)
      echo "${FIREBEETLE_PORT:-/dev/cu.wchusbserial10}"
      ;;
    esp32s3)
      echo "${ESP32S3_PORT:-/dev/cu.usbmodem101}"
      ;;
    *)
      echo "Unsupported board type: $1" >&2
      exit 1
      ;;
  esac
}

esp_device_label() {
  case "$1" in
    firebeetle-1) echo "FireBeetle-1" ;;
    firebeetle-2) echo "FireBeetle-2" ;;
    esp32s3-cam) echo "ESP32-S3-Camera" ;;
    *) echo "$1" ;;
  esac
}

esp_require_wifi_creds() {
  if [[ -z "${WIFI_SSID:-}" || -z "${WIFI_PASSWORD:-}" ]]; then
    echo "Set WIFI_SSID and WIFI_PASSWORD (e.g. source ~/.zshrc)"
    exit 1
  fi
}

esp_require_ota_password() {
  if [[ -z "${ESP32_OTA_PASSWORD:-}" ]]; then
    echo "Set ESP32_OTA_PASSWORD in ~/.zshrc.local (required — boards were flashed with OTA password)."
    exit 1
  fi
}

esp_build_extra_flags() {
  local label flags
  label="$(esp_device_label "$ESP_DEVICE_ALIAS")"
  flags="-DWIFI_SSID=\"${WIFI_SSID}\" -DWIFI_PASSWORD=\"${WIFI_PASSWORD}\" -DDEVICE_HOSTNAME=\"${ESP_DEVICE_HOSTNAME}\" -DDEVICE_LABEL=\"${label}\" -DOTA_PASSWORD=\"${ESP32_OTA_PASSWORD:-}\""
  if [[ "${ESP_DEVICE_BOARD:-}" == "esp32" ]]; then
    flags+=" -DFIREBEETLE_BATTERY=1"
  fi
  printf '%s' "$flags"
}

esp_compile_sketch() {
  local fqbn="$1"
  local build_path="$2"
  local sketch
  sketch="$(esp_active_sketch)"
  local include_flags=""
  local generated_dir="${sketch}/generated"
  if [[ -f "${generated_dir}/iot_config.h" ]]; then
    include_flags="-I${generated_dir}"
  fi
  echo "Sketch:   $sketch"
  arduino-cli compile \
    --fqbn "$fqbn" \
    --build-path "$build_path" \
    --build-property "build.extra_flags=$(esp_build_extra_flags) ${include_flags}" \
    "$sketch"
}

esp_find_ip_for_mac() {
  local target_mac
  target_mac="$(esp_normalize_mac "$1")"
  local entry ip mac
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    ip="${entry%% *}"
    mac="${entry##* }"
    mac="$(esp_normalize_mac "$mac")"
    if [[ "$mac" == "$target_mac" ]]; then
      echo "$ip"
      return 0
    fi
  done < <(arp -a | sed -n 's/.*(\([0-9.]*\)) at \([0-9a-f:]*\) on.*/\1 \2/p')
  return 1
}

esp_find_espota_py() {
  local candidate
  for candidate in \
    "$HOME/.arduino15/packages/esp32/hardware/esp32/"*/tools/espota.py \
    "$HOME/Library/Arduino15/packages/esp32/hardware/esp32/"*/tools/espota.py; do
    if [[ -f "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

esp_upload_via_cli_network() {
  local fqbn="$1"
  local ip="$2"
  local build_path="$3"
  arduino-cli upload \
    --fqbn "$fqbn" \
    --input-dir "$build_path" \
    -p "$ip" \
    -l network \
    --discovery-timeout 10s \
    --upload-field "password=${ESP32_OTA_PASSWORD}"
}

esp_upload_via_espota() {
  local ip="$1"
  local build_path="$2"
  local espota_py bin_file
  espota_py="$(esp_find_espota_py)" || {
    echo "espota.py not found — install esp32 board package via arduino-cli"
    return 1
  }
  bin_file="$(find "$build_path" -maxdepth 1 -name '*.bin' ! -name 'bootloader.bin' ! -name 'partitions.bin' ! -name 'boot_app0.bin' | head -1)"
  if [[ -z "$bin_file" ]]; then
    echo "No application .bin found in $build_path"
    return 1
  fi
  python3 "$espota_py" -i "$ip" -p 3232 -a "$ESP32_OTA_PASSWORD" -f "$bin_file"
}

esp_upload_ota() {
  local fqbn="$1"
  local ip="$2"
  local build_path="$3"
  echo "OTA upload to $ip ($ESP_DEVICE_ALIAS)..."
  if esp_upload_via_cli_network "$fqbn" "$ip" "$build_path"; then
    echo "OTA upload complete (arduino-cli)"
    return 0
  fi
  echo "arduino-cli network upload failed — trying espota.py..."
  esp_upload_via_espota "$ip" "$build_path"
}
