---
name: homehub-cores3-commission
description: >-
  Commission a factory-fresh Matter-over-Thread device onto the CoreS3
  fabric and register it in HomeHub. Use when the user asks to pair,
  commission, add IKEA, add a Matter device, add a button / BILRESA /
  remote, or gives an 11-digit Matter code.
---

# Commission a Matter device on the CoreS3

Follow [COMMISSIONING.md](../../../firmware/cores3-gateway/COMMISSIONING.md). Pair locally first, then register in HomeHub in the same session. Buttons need extra firmware (Switch **events**, not a 60 s poll). How to pick the next Thread node: [INVENTORY.md](../../../firmware/cores3-gateway/INVENTORY.md).

Default serial: `/dev/cu.usbmodem101` (`CORES3_PORT` overrides). Python with pyserial: `$HOME/.espressif/python_env/idf5.4_py3.12_env/bin/python`.

## Do not

- Pair into IKEA Home Smart, Apple Home, Google Home, or Alexa first
- Echo or commit setup codes, QR payloads, Thread dataset TLVs, or Wi-Fi passwords
- Reuse a live node id
- Run `thread start` if the role is already `leader`
- `erase-flash` unless the user asks to wipe the Thread network
- Use `ble-thread` with a guessed 12-bit discriminator — prefer `code-thread`
- Add Switch `NumberOfPositions` / `CurrentPosition` to the Matter poll loop (wakes the remote, no press data)
- Seed household `buttons` until firmware publishes the same ids (gateway MQTT overwrites Dynamo)

## Checklist

Copy and tick:

```
Pair
- [ ] Next Thread node id from the controller
- [ ] USB `/dev/cu.usbmodem*` present
- [ ] `state` is leader
- [ ] User: one device advertising, within 1 m
- [ ] `pair --node <id>`
- [ ] Device-specific verify
- [ ] Note the node id; do not commit setup codes

Register
- [ ] Next catalog id (`matter-N`, may differ from node id)
- [ ] cores3-fabric.ts + cores3_fabric.py (same spec)
- [ ] createCores3HouseholdState / cores3_household_state
- [ ] devices.test.ts + test_cores3_fabric.py
- [ ] Firmware state JSON for this kind
- [ ] Buttons: event subscribe + homehub_aws_set_button (see buttons.md)
- [ ] Bump `state.firmware` label in homehub_aws.cpp
- [ ] seed-cores3-fabric (int)
- [ ] pnpm deploy:int (homehub-deploy-int)
- [ ] OTA if firmware changed (homehub-cores3-ota)
- [ ] Confirm /devices and HUB_STATE
```

## Pair

1. Matter logo on the box. Not already on another fabric.
2. Next unused Thread node id from the controller. Do not reuse a live node.
3. User preps **one** device (below). Do not start `code-thread` until they say it is advertising and close.
4. USB required for pairing. DIN power alone has no console.
5. `scripts/firmware/cores3-matter-console.py`: `state`, then `pair`, then verify.
6. USB often drops after `code-thread` on this image. Wait for `/dev/cu.usbmodem*` to return. Re-check `leader`. **Do not pair again** if logs already showed `Commissioning success` for that node.
7. Register in HomeHub (do not stop).

### Device prep (user)

Mains first (bulbs, then plugs), remotes next, battery sensors last. Window ~15 minutes.

| Kind | Prep |
|---|---|
| Bulb | Non-dimmer socket. One off/on reopens. Factory reset = 6 on/off. |
| Plug | Press ON/OFF to reopen (~15 min). Do not hold 10 s. |
| BILRESA | Batteries in. **One** System-button press (battery door). LED pulses ~15 min. Do **not** press four times (direct-to-bulb, 30 s). Reset = hold System 10 s until red LED stops. |
| KLIPPBOK | Batteries in. Auto-advertises ~15 min. System button in the battery door reopens pairing. Place on a level surface; do not submerge. |
| TIMMERFLOTTE / ALPSTUGA | Power, then System button if no white LED. |
| MYGGBETT | Pair before sticking it down. Yellow LED after the battery goes in. |
| MYGGSPRAY | Batteries in; wave a hand if occupancy reads 0. |

### Script

Prefer `SETUP_PAYLOAD` over `--code`.

```bash
PY="$HOME/.espressif/python_env/idf5.4_py3.12_env/bin/python"
PORT="${CORES3_PORT:-/dev/cu.usbmodem101}"

$PY scripts/firmware/cores3-matter-console.py --port "$PORT" state
SETUP_PAYLOAD='<11-digit-or-QR>' $PY scripts/firmware/cores3-matter-console.py --port "$PORT" pair --node <id>
$PY scripts/firmware/cores3-matter-console.py --port "$PORT" send --wait 25 --cmd 'matter esp controller read-attr <id> 0 0x0028 3'
```

`pair` loads the dataset on the board, turns on commissioning quiet (`matter esp homehub commission on`: no Matter polls, no subscriptions, MQTT paused), then redacts secrets. Quiet auto-clears after 180 s. If Wi-Fi is down: `wifi-connect` (creds from `~/.zshrc.local`, never printed), then `ifconfig up` / `thread start` only if not already leader.

### Verify

| Kind | Command | Pass |
|---|---|---|
| Bulb / plug | `invoke-cmd <id> 1 6 0` then `6 1` | Status `0x0`; load changes |
| TIMMERFLOTTE | `read-attr <id> 1 0x0402 0` and `2 0x0405 0` | Temp / humidity hundredths |
| MYGGSPRAY | `read-attr <id> 2 0x0406 0` and `1 0x0400 0` | Occupancy bit 0; illuminance |
| MYGGBETT | `read-attr <id> 1 0x0045 0` | `StateValue` flips with the magnet |
| ALPSTUGA | ep1: `0x0402`, `0x0405`, `0x040d`, `0x042a`, `0x005B` | OnOff is the display |
| BILRESA | `read-attr <id> 0 0x0028 3` then `1 0x003B 0` and `2 0x003B 0` | ProductName `BILRESA dual button`; `NumberOfPositions` 2. No endpoint 3. No OnOff load. |
| KLIPPBOK | `read-attr <id> 0 0x0028 3` then `1 0x0045 0` | ProductName `KLIPPBOK water leak sensor`; FALSE = dry, TRUE = leak |

Sleepy devices can take several seconds. `0x5C3` = wrong cluster/endpoint (reached the node). Timeout = asleep or not on the fabric.

## Register in HomeHub

Catalog id `matter-N` **can differ** from the Thread node id. ALPSTUGA is `matter-6` / node 7. KLIPPBOK is `matter-7` / node 9. GRILLPLATS is `matter-9` / node 10. GRILLPLATS 2 is `matter-10` / node 11. BILRESA is on the fabric as **node 8** and is **not** in the catalog yet — first button register is `matter-8` / node 8.

Keep these in lockstep (same `deviceId`, `name`, `nodeId`, `endpoint`, `clusters`):

| File | What to add |
|---|---|
| `packages/core/src/cores3-fabric.ts` | `CORES3_FABRIC_DEVICES` row |
| `services/api/src/homehub_api/cores3_fabric.py` | Same row + household array |
| `packages/core/src/hub.ts` | `createCores3HouseholdState` |
| `packages/core/src/devices.test.ts` | Expect the new id |
| `services/api/tests/test_cores3_fabric.py` | Expect the new id |
| Firmware `kNodes` / state JSON | Only clusters you will actually read or subscribe |

| Kind | `type` | Household array | Firmware |
|---|---|---|---|
| Bulb | `light` | `lights` | Already polls OnOff + Level; subscribe node |
| Plug | `plug` | `plugs` | OnOff like the bulb; fill `plugs` in `homehub_aws.cpp` (today empty) |
| Climate | `environmental-sensor` | `climates` | Poll measured values (ALPSTUGA pattern) |
| Motion | `motion-sensor` | `motions` | Occupancy + illuminance |
| Contact | `contact-sensor` | `contacts` | Boolean State |
| **Button** | `button` | `buttons` | **Events. See [buttons.md](buttons.md).** |

Then:

```bash
pnpm sso
SST_STAGE=int bash scripts/provisioning/seed-cores3-fabric.sh
pnpm deploy:int
```

If firmware changed: bump the label in `homehub_aws.cpp`, follow `homehub-cores3-ota`, wait until `HUB_STATE.state.firmware` matches.

`/devices` lists catalog rows. Household cards and the floor-plan live bind follow `HUB_STATE`. The floor-plan palette has no `button` kind yet — adding one is optional and is in [buttons.md](buttons.md).

## Failures

Use the table in COMMISSIONING.md. Immediate `0x05000102` or `INCORRECT_STATE`: hard-reset (`esptool.py --chip esp32s3 --port "$PORT" --after hard_reset chip_id`), restore Wi-Fi/Thread if needed, resend slowly. Console `restart` may fail. Hard reset keeps NVS.
