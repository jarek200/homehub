#!/usr/bin/env bash
# Shared helpers for HomeHub Timer Camera F USB and OTA flash scripts.
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_REPO_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
ESP_DEVICES_CONF="${ESP_DEVICES_CONF:-$_REPO_ROOT/firmware/timer-camera/devices.conf}"
ESP_FIRMWARE_DIR="${ESP_FIRMWARE_DIR:-$_REPO_ROOT/firmware/timer-camera}"

esp_resolve_sketch() {
  local sketch="${1:-${ESP_SKETCH:-timer-camera-f}}"
  case "$sketch" in
    timer-camera-f)
      echo "$ESP_FIRMWARE_DIR/$sketch"
      ;;
    /* | ./* | ../*)
      echo "$sketch"
      ;;
    *)
      echo "Unknown sketch: $sketch" >&2
      echo "Known sketches: timer-camera-f" >&2
      exit 1
      ;;
  esac
}

esp_default_sketch_for_board() {
  case "$1" in
    timer-cam-f) echo "timer-camera-f" ;;
    *)
      echo "Unsupported board type: $1" >&2
      exit 1
      ;;
  esac
}

esp_active_sketch() {
  if [[ -n "${ESP_OTA_SKETCH:-}" ]]; then
    esp_resolve_sketch "$ESP_OTA_SKETCH"
    return
  fi
  esp_resolve_sketch "${ESP_SKETCH:-timer-camera-f}"
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
    timer-cam-f)
      # 4 MB flash + PSRAM. min_spiffs keeps two 1.875 MB OTA app slots.
      echo "esp32:esp32:m5stack_timer_cam:PSRAM=enabled,PartitionScheme=min_spiffs"
      ;;
    *)
      echo "Unsupported board type: $1" >&2
      exit 1
      ;;
  esac
}

esp_default_usb_port() {
  case "$1" in
    timer-cam-f)
      if [[ -n "${TIMER_CAM_F_PORT:-}" ]]; then
        echo "$TIMER_CAM_F_PORT"
        return
      fi
      local found
      found="$(ls /dev/cu.usbserial* /dev/cu.wchusbserial* /dev/cu.usbmodem* 2>/dev/null | head -1 || true)"
      if [[ -n "$found" ]]; then
        echo "$found"
        return
      fi
      echo "Set TIMER_CAM_F_PORT to the camera serial device." >&2
      exit 1
      ;;
    *)
      echo "Unsupported board type: $1" >&2
      exit 1
      ;;
  esac
}

esp_device_label() {
  case "$1" in
    timer-cam-f) echo "TimerCAM-F" ;;
    *) echo "$1" ;;
  esac
}

esp_load_secret_file() {
  local file="$1"
  local line key value
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    line="${line#export }"
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    case "$key" in
      WIFI_SSID | WIFI_PASSWORD | ESP32_OTA_PASSWORD) ;;
      *) continue ;;
    esac
    if [[ -n "${!key:-}" ]]; then
      continue
    fi
    if [[ ${#value} -ge 2 && ( ${value:0:1} == '"' || ${value:0:1} == "'" ) && ${value:0:1} == ${value: -1} ]]; then
      value="${value:1:${#value}-2}"
    fi
    printf -v "$key" '%s' "$value"
    export "$key"
  done <"$file"
}

esp_load_local_secrets() {
  esp_load_secret_file "$_REPO_ROOT/.env.local"
  esp_load_secret_file "$HOME/.zshrc.local"
}

esp_require_wifi_creds() {
  esp_load_local_secrets
  if [[ -z "${WIFI_SSID:-}" || -z "${WIFI_PASSWORD:-}" ]]; then
    echo "Set WIFI_SSID and WIFI_PASSWORD in .env.local"
    exit 1
  fi
}

esp_require_ota_password() {
  esp_load_local_secrets
  if [[ -z "${ESP32_OTA_PASSWORD:-}" ]]; then
    echo "Set ESP32_OTA_PASSWORD in .env.local (required — boards were flashed with OTA password)."
    exit 1
  fi
}

esp_build_extra_flags() {
  local label flags
  label="$(esp_device_label "$ESP_DEVICE_ALIAS")"
  flags="-DWIFI_SSID=\"${WIFI_SSID}\" -DWIFI_PASSWORD=\"${WIFI_PASSWORD}\" -DDEVICE_HOSTNAME=\"${ESP_DEVICE_HOSTNAME}\" -DDEVICE_LABEL=\"${label}\" -DOTA_PASSWORD=\"${ESP32_OTA_PASSWORD:-}\""
  if [[ "${ESP_DEVICE_BOARD:-}" == "timer-cam-f" ]]; then
    flags+=" -DBOARD_HAS_PSRAM -mfix-esp32-psram-cache-issue -mfix-esp32-psram-cache-strategy=memw"
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
  arduino-cli lib install "ArduinoJson" "ArduinoMqttClient" >/dev/null 2>&1 || true
  arduino-cli compile \
    --fqbn "$fqbn" \
    --build-path "$build_path" \
    --build-property "compiler.cpp.extra_flags=$(esp_build_extra_flags) ${include_flags}" \
    --build-property "compiler.c.extra_flags=$(esp_build_extra_flags) ${include_flags}" \
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
