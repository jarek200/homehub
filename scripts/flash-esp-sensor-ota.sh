#!/usr/bin/env bash
# OTA flash environmental sensor firmware to a FireBeetle (no USB).
# Usage: bash scripts/flash-esp-sensor-ota.sh firebeetle-1|firebeetle-2
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/flash-esp-ota.sh" "${1:-firebeetle-1}" environmental-sensor-ota
