#!/usr/bin/env bash
# List registered HomeHub ESP devices visible on the local network.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/esp-devices.sh
source "$ROOT/scripts/lib/esp-devices.sh"

printf "%-14s %-22s %-18s %s\n" "ALIAS" "HOSTNAME" "MAC" "IP"
printf "%-14s %-22s %-18s %s\n" "-----" "--------" "---" "--"

while IFS='|' read -r alias board hostname mac; do
  [[ "$alias" =~ ^# ]] && continue
  [[ -z "$alias" ]] && continue
  ip="(offline)"
  if found_ip="$(esp_find_ip_for_mac "$mac" 2>/dev/null)"; then
    ip="$found_ip"
  fi
  printf "%-14s %-22s %-18s %s\n" "$alias" "$hostname" "$mac" "$ip"
done < "$ESP_DEVICES_CONF"
