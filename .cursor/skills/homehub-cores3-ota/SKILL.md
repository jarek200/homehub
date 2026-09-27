---
name: homehub-cores3-ota
description: >-
  Push CoreS3 gateway firmware over HTTPS OTA and read live device
  state (lights, sensors, heap) from AWS without USB serial. Use when
  the user asks to OTA the CoreS3, flash-cores3-ota, check gateway
  state, read heap/RAM over the air, or confirm an OTA landed.
---

# CoreS3 OTA and device state

The CoreS3 is on home Wi-Fi. Do not require USB to read state or to ship a new app image. USB is only for the first OTA-capable flash, or if A/B OTA is broken.

Default device id: `cores3-gateway`. Stage: `int`.

## Auth

```bash
pnpm sso
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
export AWS_PROFILE=homehub-int
export AWS_REGION=eu-west-1
export SST_STAGE=int
```

If `AWS_PROFILE=prod` is already in the shell, overwrite it. Inherited env keys make `scripts/lib/aws-stage.sh` drop the profile.

## Read live state (no OTA)

State is MQTT `homehub/gateways/cores3-gateway/state` → IoT Rule → Dynamo `HUB_STATE`. The board publishes about once a minute, and again after MQTT reconnect.

```bash
TABLE="$(aws dynamodb list-tables --query "TableNames[?contains(@, 'AppTable')]|[0]" --output text)"
PK="$(aws dynamodb get-item --table-name "$TABLE" \
  --key '{"PK":{"S":"GATEWAY#cores3-gateway"},"SK":{"S":"HOUSEHOLD"}}' \
  --query 'Item.tenantPk.S' --output text)"

aws dynamodb get-item --table-name "$TABLE" \
  --key "{\"PK\":{\"S\":\"$PK\"},\"SK\":{\"S\":\"HUB_STATE\"}}" \
  --query 'Item.{updatedAt:updatedAt.S,gatewayId:gatewayId.S,firmware:state.M.firmware.S,memory:state.M.memory,lights:state.M.lights,contacts:state.M.contacts,motions:state.M.motions}' \
  --output json
```

`updatedAt` more than ~2 minutes old means MQTT is down (board off, Wi-Fi down, or rolled back).

### What the payload contains

| Field | Meaning |
|---|---|
| `state.firmware` | Image label from `homehub_aws.cpp` (bump this when you need an OTA proof) |
| `state.lights` / `contacts` / `motions` | Household cards (KAJPLATS, MYGGBETT, MYGGSPRAY) |
| `state.memory` | Heap snapshot in **bytes** |
| `readings[]` | Per-device metrics, including `cores3-gateway` heap keys |

`state.memory` keys: `internalFree`, `internalLargest`, `internalMinFree`, `spiramFree`, `spiramLargest`, `spiramMinFree`.

Internal RAM is the constraint. `internalLargest` is the biggest single allocation that can succeed. PSRAM is the 8 MB Quad pool.

There is no IoT Thing named `cores3-gateway` and no device shadow. The Thing is `homehub-cores3-gateway`. Read Dynamo, not `get-thing-shadow`.

## Push OTA

The board must already be on the A/B image (`partitions_16mb.csv`). Then:

```bash
SST_STAGE=int bash scripts/firmware/flash-cores3-ota.sh
```

That overlays sources into `~/esp/esp-matter/examples/controller`, builds `controller.bin`, uploads `s3://homehub-firmware-int/gateways/cores3-gateway/controller.bin`, and publishes

```text
homehub/gateways/cores3-gateway/ota
homehub/gateways/cores3-gateway/commands
```

with `{ "command": "ota", "url": "https://<restApi>/firmware/cores3-gateway?token=<etag>" }`.

The URL **must** be the REST `/firmware/{id}?token=` route. That route returns **200** `application/octet-stream` (about 2.5 MB). Do not publish a raw S3 presigned URL. The ESP client fails on the long 307 `Location` (SSO session token).

`GET /firmware/...` is unauthenticated except for the ETag token. Do not make the firmware object public — the bin embeds IoT certs.

### If `idf.py` says the 3.9 venv is missing

`export.sh` must see Python 3.12, not macOS 3.9 or Homebrew 3.14:

```bash
BINDIR="/tmp/idf-py312"
mkdir -p "$BINDIR"
ln -sf /opt/homebrew/bin/python3.12 "$BINDIR/python3"
export PATH="$BINDIR:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export IDF_PATH="$HOME/esp/esp-idf"
export ESP_MATTER_PATH="$HOME/esp/esp-matter"
. "$IDF_PATH/export.sh"
cd "$HOME/esp/esp-matter/examples/controller"
idf.py build
```

Then upload with the already-built bin:

```bash
uv run --directory services/api python "$PWD/scripts/firmware/flash-cores3-ota.py" \
  --bin "$HOME/esp/esp-matter/examples/controller/build/controller.bin" \
  --device-id cores3-gateway \
  --stage int
```

`uv` lives at `~/.local/bin/uv`. Pass the script as an **absolute** path; `uv run --directory services/api` changes cwd.

### Confirm the OTA URL before / after publish

```bash
ETAG="$(aws s3api head-object --bucket homehub-firmware-int \
  --key gateways/cores3-gateway/controller.bin --query ETag --output text | tr -d '"')"
API="$(aws apigatewayv2 get-apis --query "Items[?contains(Name, 'homehub-int-DeviceRestApi')].ApiEndpoint" --output text)"
curl -sS -o /dev/null -D - "$API/firmware/cores3-gateway?token=$ETAG" | head -15
```

Expect `HTTP/2 200` and `content-type: application/octet-stream`. A `HEAD` (`curl -I`) is `405` — the route is GET only. `307` means the old redirect handler is still deployed — run `pnpm deploy:int` first.

API logs: filter `/aws/lambda/homehub-int-DeviceRestApi*` for `GET /firmware/cores3-gateway`. A hit after publish means the board received MQTT. No hit means it missed the command (publish again; QoS 1 is not retained).

## Confirm the new image

Poll `HUB_STATE` until `state.firmware` matches the label you shipped (current tree: `sns-alerts-1` in `homehub_aws.cpp`). Download + reboot + MQTT is usually 30–90 s. If firmware has not changed after ~3 minutes and there was no `/firmware` log line, republish the OTA command.

Rollback: if the new slot never confirms MQTT, the bootloader returns to the previous slot and `firmware` stays on the old label.

## Do not

- Use USB `idf.py monitor` / `matter esp diagnostics mem-dump` unless OTA or MQTT is dead
- `erase-flash` (wipes Thread + Wi-Fi NVS)
- Publish OTA URLs that are not `https://*.amazonaws.com`
- Put Thread dataset TLVs, setup codes, or Wi-Fi passwords in the skill output or git
