# Commission a Matter device on the CoreS3

Reusable playbook for the next IKEA device and, later, other Matter-over-Thread vendors. A person or a coding agent can follow it step by step.

History of the first bulb: [BRINGUP.md](./BRINGUP.md). Next node id: [INVENTORY.md](./INVENTORY.md). Devices registered in HomeHub: `fabricDevices` in [packages/catalog/homehub.json](../../packages/catalog/homehub.json).

---

## When to use this

- User has a factory-fresh Matter-over-Thread device and an 11-digit code or QR payload.
- CoreS3 already runs the esp-matter controller + OTBR image (factory web GUI is gone).
- Device is **not** already in IKEA Home Smart, Apple Home, Google Home, or Alexa.

## When not to use this

- Box has no Matter logo (Zigbee-only: PARASOLL, VALLHORN, old TRÅDFRI).
- User already commissioned the device on another fabric (needs that fabric to share, or a factory reset).
- Cloud / HomeHub MQTT — local OnOff must work first.

---

## Prerequisites (check, do not redo blindly)

Serial: **`/dev/cu.usbmodem101`** on this Mac.

```text
matter esp ot_cli state
```

Must be `leader`. If `disabled` / `offline`:

```text
matter esp wifi connect <ssid> <password>
matter esp ot_cli ifconfig up
matter esp ot_cli thread start
```

Wait until `state` is `leader`. Do **not** `thread start` if already leader.

Get the active dataset (secret — do not log or commit):

```text
matter esp ot_cli dataset active -x
```

If Wi-Fi is down, credentials are in `~/.zshrc.local` as `WIFI_SSID` / `WIFI_PASSWORD`. Never print the password.

---

## Device prep (user)

1. Photograph QR + 11-digit code (bulb base + leaflet). Do not commit the code.
2. Power **one** new device. Mains first (bulbs, then plug), remotes next, battery sensors last.
3. Non-dimmer socket for bulbs.
4. Keep the device within a metre of the CoreS3 (BLE for PASE, then Thread).
5. Pairing window ~15 minutes after power-on. **One** off/on reopens it.
6. Factory reset = **6** on/off cycles (IKEA Matter). Do not do this unless the window is dead and a single cycle failed.

---

## Pick the next node id

Ask the controller which nodes already exist. Do not reuse a live node id. See [INVENTORY.md](./INVENTORY.md).

---

## Pair

Prefer `code-thread` with the 11-digit code or QR payload. The manual code only has a 4-bit short discriminator; `ble-thread` needs the full 12-bit value from the QR or it will ignore the right bulb.

```text
matter esp controller pairing code-thread <nodeid> <dataset_tlvs> <setup_payload>
```

Send the line slowly (~3 ms per character) over USB serial or the shell truncates the dataset.

Success logs:

- `Device Discriminator match`
- `PASE session establishment success`
- `Received ConnectNetwork response, networkingStatus=0`
- `Commissioning complete for node ID 0x…: success`
- `Commissioning success with node …-<nodeid>`

---

## Verify

OnOff (bulbs and plugs), cluster `6`, endpoint `1` on KAJPLATS:

```text
matter esp controller invoke-cmd <nodeid> 1 6 0
matter esp controller invoke-cmd <nodeid> 1 6 1
```

Status `0x0` = success. The user should see the light/plug change with AWS disconnected.

TIMMERFLOTTE (temp/humidity, sleepy Thread). Pairing: batteries in, press the **System** button in the battery compartment if it is not already advertising (white LED, ~15 min). Verify with reads, not OnOff:

```text
matter esp controller read-attr <nodeid> 1 0x0402 0
matter esp controller read-attr <nodeid> 2 0x0405 0
```

Temperature `MeasuredValue` is hundredths of °C (2406 = 24.06 °C). Humidity is hundredths of % RH (8452 = 84.52 %). The sensor can take several seconds to answer.

MYGGSPRAY (motion + lux, sleepy Thread):

```text
matter esp controller read-attr <nodeid> 2 0x0406 0
matter esp controller read-attr <nodeid> 1 0x0400 0
```

Occupancy bit 0 set (`1`) means motion/occupied. Illuminance `MeasuredValue` uses the Matter log encoding. Wave a hand in front of the sensor if occupancy reads `0` right after pairing.

MYGGBETT (door/window contact, sleepy Thread). Pair before sticking it down. Yellow LED = pairing window after the battery goes in.

```text
matter esp controller read-attr <nodeid> 1 0x0045 0
```

`StateValue` TRUE = open (magnet apart); FALSE = closed. Separate the two halves to confirm it flips.

ALPSTUGA (air quality, USB-C mains). Plug in; press the **System** button if it is not advertising (white LED, ~15 min). Verify with reads on endpoint 1 (OnOff on this device is the display, not a load):

```text
matter esp controller read-attr <nodeid> 1 0x0402 0
matter esp controller read-attr <nodeid> 1 0x0405 0
matter esp controller read-attr <nodeid> 1 0x040d 0
matter esp controller read-attr <nodeid> 1 0x042a 0
matter esp controller read-attr <nodeid> 1 0x005b 0
```

Temperature and humidity use the same hundredths encoding as TIMMERFLOTTE. CO2 `MeasuredValue` is ppm. PM2.5 is cluster `0x042A`; air quality is `0x005B`.

BILRESA (dual-button remote, sleepy Thread). Batteries in. **One** press on the System button in the battery door — LED pulses ~15 minutes. Do **not** press four times (that is direct-to-bulb pairing, 30 s). Verify with reads, not OnOff (there is no load):

```text
matter esp controller read-attr <nodeid> 0 0x0028 3
matter esp controller read-attr <nodeid> 1 0x003B 0
matter esp controller read-attr <nodeid> 2 0x003B 0
```

Endpoint 0 Basic Information `ProductName` is `BILRESA dual button`. Endpoints 1 and 2 are Generic Switch (`0x003B`); attribute 0 is `NumberOfPositions` (2). There is no endpoint 3. Factory reset: hold System 10 s until the red LED stops, then it advertises for 15 minutes.

KLIPPBOK (water leak, sleepy Thread). Batteries in; System button in the battery door reopens pairing. Verify with Boolean State, not OnOff:

```text
matter esp controller read-attr <nodeid> 0 0x0028 3
matter esp controller read-attr <nodeid> 1 0x0045 0
```

`ProductName` is `KLIPPBOK water leak sensor`. `StateValue` FALSE = dry; TRUE = leak (wet contacts). Catalog id `matter-7` / node 9.

Then add the device to `fabricDevices` in `packages/catalog/homehub.json` if it should appear in HomeHub. No setup codes.

---

## Failures we already hit

| Symptom | Likely cause | Fix |
|---|---|---|
| Immediate `Error: 83886338` / `0x05000102` | Leftover pairing or truncated command | Hard-reset CoreS3, restore Wi-Fi/Thread, resend slowly |
| `INCORRECT_STATE` (CHIP `0x03`) after BLE connect | Previous `PairDevice` still open | Hard reset (`esptool.py … --after hard_reset chip_id`). Console `restart` may fail |
| `Discriminator did not match` | `ble-thread` with a guessed 12-bit disc | Use `code-thread` + 11-digit / QR |
| `Discovery timed out` | Bulb not advertising | One power cycle; stay close; retry within ~15 min |
| `kPaaNotFound` / err **101** / `CHIP:0x000000AC` | Missing vendor PAA | Add `.der` under `paa_cert/`, rebuild SPIFFS, flash **without** erase |
| `leader` → `detached` | Extra `thread start` | Wait; poll `state` until `leader` |
| `idf.py` / `No module named click` | Homebrew Python 3.14 on `PATH` | Clean `PATH` then `. ~/esp/esp-idf/export.sh` |
| GRILLPLATS: `GATT discovery failed` / `peer_add failed` / CoreS3 `LoadProhibited` | BLE drop while Matter polls / subscriptions / MQTT share the radio | Use firmware `grillplats-quiet-1+`. `pair` runs `matter esp homehub commission on` first (stops polls, subscriptions, MQTT for 180 s). Press plug **ON/OFF** to reopen pairing (15 min), keep it next to the CoreS3, retry `code-thread`. Do **not** hold 10 s (that factory-resets). |
| `Cannot add more services` / `CONFIG_MDNS_MAX_SERVICES (10)` then CASE timeout | OTBR SRP/mDNS table full | Set `CONFIG_MDNS_MAX_SERVICES=32` in the CoreS3 overlay, rebuild, flash **without** erase. Device may already be on the fabric — try `read-attr` before pairing again. |

Hard reset does not wipe NVS. `erase-flash` does — you will form a **new** Thread network.

---

## Other vendors

1. Confirm Matter-over-Thread (not Wi-Fi-only Matter, not Zigbee).
2. Find VID (QR / DCL / CHIP PAA filename `vid_0x….pem`).
3. Add that PAA as DER to [paa_cert/](./paa_cert/). `scripts/provisioning/provision-cores3-iot.sh` copies it into the controller.
4. Keep `CONFIG_SPIFFS_ATTESTATION_TRUST_STORE=y`. Mount label is **`paa_cert`** (not the `rcp_fw` SPIFFS); [overlays/esp_matter_attestation_trust_store.patch](./overlays/esp_matter_attestation_trust_store.patch) does that.
5. Rebuild and `idf.py -p /dev/cu.usbmodem101 flash` (no erase).
6. Pair with `code-thread` as above.

Fetch production roots from CSA DCL (CHIP script `credentials/fetch_paa_certs_from_dcl.py`) or copy from `connectedhomeip/credentials/production/paa-root-certs`. Convert: `openssl x509 -inform pem -outform der -in foo.pem -out foo.der`.

IKEA VID is **`0x117C`**. DigiCert Matter PAA is already in `paa_cert/` for devices that chain through it.

---

## Rebuild / flash (only if firmware or PAAs changed)

```bash
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export IDF_PATH="$HOME/esp/esp-idf"
. "$HOME/esp/esp-idf/export.sh"
cd "$HOME/esp/esp-matter/examples/controller"
idf.py -D SDKCONFIG_DEFAULTS="sdkconfig.defaults.otbr;sdkconfig.defaults.cores3" build
idf.py -p /dev/cu.usbmodem101 flash
```

This package is the source of truth. Run `SST_STAGE=int bash scripts/provisioning/provision-cores3-iot.sh --no-flash` first to copy `sdkconfig.defaults.cores3`, `partitions_16mb.csv`, `main/esp_ot_config.h`, `paa_cert/`, and the trust store patch into the controller. Change files here, not in `~/esp`.

---

## Automation checklist

Serial helper: [scripts/firmware/cores3-matter-console.py](../../scripts/firmware/cores3-matter-console.py).

- Trigger on “pair / commission / add IKEA / add Matter device / add button / BILRESA / 11-digit code”.
- Read this file + [INVENTORY.md](./INVENTORY.md).
- Check `leader`, fetch dataset privately, pick the next node id.
- Run `code-thread`, then the right verify command (OnOff for bulbs/plugs).
- Update inventory, then register in HomeHub (catalog + household + seed + deploy). Buttons also need Switch **event** firmware and OTA before seed, or MQTT wipes `buttons`.
- Never commit or echo secrets.
- Never pair into IKEA/Apple/Google first.
- Never `erase-flash` unless the user asks to wipe the Thread network.
