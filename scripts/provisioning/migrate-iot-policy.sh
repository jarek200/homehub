#!/usr/bin/env bash
# Attach homehub-<stage>-device to every certificate on the old simulator policy, then detach the old policy.
# Run after DeviceIotPolicy exists and before deleting SimulatorIotPolicy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/aws-stage.sh
source "$ROOT/scripts/lib/aws-stage.sh"

STAGE="${1:-int}"
homehub_aws_stage_env "$STAGE"
homehub_aws_check_auth

OLD_POLICY="${OLD_IOT_POLICY:-homehub-${STAGE}-simulator}"
NEW_POLICY="${NEW_IOT_POLICY:-homehub-${STAGE}-device}"

marker=""
moved=0
while true; do
  if [[ -n "$marker" ]]; then
    page="$(aws iot list-targets-for-policy --policy-name "$OLD_POLICY" --marker "$marker" --output json)"
  else
    page="$(aws iot list-targets-for-policy --policy-name "$OLD_POLICY" --output json)"
  fi
  targets="$(python3 -c 'import json,sys; print("\n".join(json.load(sys.stdin).get("targets") or []))' <<<"$page")"
  if [[ -n "$targets" ]]; then
    while IFS= read -r target; do
      [[ -z "$target" ]] && continue
      aws iot attach-policy --policy-name "$NEW_POLICY" --target "$target"
      aws iot detach-policy --policy-name "$OLD_POLICY" --target "$target"
      moved=$((moved + 1))
      echo "Moved $target"
    done <<<"$targets"
  fi
  marker="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("nextMarker") or "")' <<<"$page")"
  [[ -z "$marker" ]] && break
done

echo "Moved ${moved} targets from ${OLD_POLICY} to ${NEW_POLICY}"
