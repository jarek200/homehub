# CoreS3 Thread BR + IKEA — what we did

This is the bench history for the M5Stack **K149** (CoreS3 + Module Gateway H2 + DIN). The add-device skill is `homehub-cores3-commission`.

**Add the next bulb or plug:** follow [COMMISSIONING.md](./COMMISSIONING.md).  
**What is on the fabric now:** [INVENTORY.md](./INVENTORY.md).

Do not put Thread dataset TLVs, PSKc, Border Agent IDs, Wi-Fi passwords, or Matter setup codes in git.

---

## Goal

Local-first Matter / Thread gateway on the CoreS3. IKEA devices join **over the air**. No DIRIGERA, no Home Assistant, no IKEA / Apple / Google app first (that spends the first-fabric setup code). USB-C on the CoreS3 is power, serial, and flash only.

AWS IoT / HomeHub cloud come later, after local OnOff works.

---

## Hardware (leave stacked)

| Piece | Role |
|---|---|
| CoreS3 | ESP32-S3 host, 16 MB flash, **8 MB Quad PSRAM** (not Octal), USB-C, LCD |
| Module Gateway H2 | ESP32-H2 Thread RCP |
| DIN base | Power / mechanical only |

Official UART (Espressif M5Stack Kconfig, not the generic ESP OTBR defaults):

| Signal | GPIO |
|---|---|
| Host RX (from H2) | **10** |
| Host TX (to H2) | **17** |
| RCP reset | **7** |
| RCP boot | **18** |
| Baud | 460800 |

Do not use Espressif’s generic G17/G18 host UART or Octal PSRAM. Those boot-loop or kill the H2 link on this kit.

IKEA devices are **not** wired to the kit.

---

## Phase 1 — factory Thread border router (done)

The kit arrived with factory `esp_ot_br` already flashed.

| Field | Value |
|---|---|
| Project | `esp_ot_br` |
| App | `v1.3-32-gbb452f4` (compiled 13 Apr 2026) |
| ESP-IDF on that image | `v5.5.4-266-g50c71d69b84` |
| SoftAP | `ESP-ThreadBR-…` → `http://192.168.4.1` |
| Home Wi-Fi | 2.4 GHz LAN (SSID stays on the board, not in git) |
| Web GUI name | `ESP-BR-…` |
| Thread | **leader**, IPv6 preferred |

That GUI is Thread status only. It **cannot add a Matter bulb**. Do not tap **Share Thread Network Credential** unless a *different* commissioner needs the dataset.

Factory restore later: [M5Burner](https://docs.m5stack.com/en/guide/restore_factory/cores3_thread_br) (hold reset ~2 s until the green LED). Official example: [espressif/esp-thread-br `examples/m5stack_thread_border_router`](https://github.com/espressif/esp-thread-br/tree/master/examples/m5stack_thread_border_router).

---

## Phase 2 — Matter commissioner (replaced the factory UI)

Factory firmware cannot commission Matter. We flashed [esp-matter `examples/controller`](https://github.com/espressif/esp-matter/tree/main/examples/controller) with `sdkconfig.defaults.otbr` plus the HomeHub CoreS3 overlay.

Toolchain lives in `~/esp` (not this git repo). **Do not mix IDF versions in one shell.**

| Tree | Version | Why |
|---|---|---|
| `~/esp/esp-idf` | **v5.4.1** | Pin for esp-matter v1.4 |
| `~/esp/esp-matter` | **release/v1.4** | Controller + CHIP |
| Factory BR (old image) | IDF 5.5.4 | Historical only |

Activate (Homebrew Python 3.14 on PATH breaks `idf.py` — `No module named click`):

```bash
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export IDF_PATH="$HOME/esp/esp-idf"
. "$HOME/esp/esp-idf/export.sh"
# Uses ~/.espressif/python_env/idf5.4_py3.12_env
```

H2 RCP was built from `~/esp/esp-idf/examples/openthread/ot_rcp` (esp32h2). Controller:

```bash
cd "$HOME/esp/esp-matter/examples/controller"
idf.py -D SDKCONFIG_DEFAULTS="sdkconfig.defaults.otbr;sdkconfig.defaults.cores3" \
  set-target esp32s3 build
idf.py -p /dev/cu.usbmodem101 erase-flash flash   # first time only
```

Serial port on this Mac: **`/dev/cu.usbmodem101`**.

Overlays applied in the live tree (`~/esp/esp-matter/examples/controller`) and copied here:

- [sdkconfig.defaults.cores3](./sdkconfig.defaults.cores3) — 16 MB, Quad PSRAM, RCP auto-update, **SPIFFS PAA store**
- [main/esp_ot_config.h](./main/esp_ot_config.h) — UART RX=10, TX=17
- Live firmware also sets RCP boot=**18** (not 8) and reset=7
- [partitions_br.csv](./partitions_br.csv) — extra `paa_cert` SPIFFS slot after `rcp_fw`
- [paa_cert/](./paa_cert/) — IKEA VID `0x117C` + DigiCert Matter PAA as `.der`

After flash, the factory web GUI is gone. Rejoin Wi-Fi and form Thread over serial:

```text
matter esp wifi connect <ssid> <password>
matter esp ot_cli dataset init new
matter esp ot_cli dataset commit active
matter esp ot_cli dataset active -x
matter esp ot_cli ifconfig up
matter esp ot_cli thread start
matter esp ot_cli state
```

`state` must print `leader`. Do not run `thread start` again while already leader — that drops the role to `detached` for a while.

The active dataset TLV from `dataset active -x` is a secret. Keep it on the board / in a password manager, not in this repo. Later pairing commands need that same TLV.

Wi-Fi + Thread NVS usually survive a **flash without erase**. After `erase-flash` or a full NVS wipe, redo Wi-Fi and `dataset init new` (that creates a **new** Thread network; already-joined devices will not follow).

---

## Phase 3 — first KAJPLATS (done 9 Sep 2026)

1. One factory-fresh KAJPLATS in a **non-dimmer** socket. Photograph QR + 11-digit code. Leave every other IKEA box closed.
2. Do not add it in IKEA / Apple / Google.
3. Pairing window is ~15 minutes after power-on. Cycle power **once** to reopen. Factory reset = **6** on/off (not 12).
4. Commission from the CoreS3 serial console with `code-thread` (not `ble-thread` unless you have the full 12-bit discriminator from the QR).

What failed, then worked:

| Attempt | Result | Cause |
|---|---|---|
| `code-thread` (first) | `CHIP:0x05000102` / aborted | Leftover pairing session + truncated long command |
| `ble-thread` with guessed disc `1024` | “Discriminator did not match” | 11-digit code only encodes a **4-bit short** discriminator |
| `code-thread` after leftover session | BLE connected, `INCORRECT_STATE` (0x03) | Previous `PairDevice` still held PASE |
| Same, after hard reset | PASE OK, then **`kPaaNotFound` (err 101)** | Controller trusted Chip-Test PAA only |
| After IKEA PAA flash + power-cycle | **Commissioning success**, node `1` | SPIFFS PAA + bulb advertising again |
| `invoke-cmd 1 1 6 0` then `6 1` | Status `0x0` | Local OnOff over Thread |

Hard reset (does not erase NVS): `esptool.py --chip esp32s3 --port /dev/cu.usbmodem101 --after hard_reset chip_id`. Console `restart` returned `Error: -1` on this image.

Long console lines (dataset + setup code) must be typed slowly (~3 ms/char) or the shell truncates them.

---

## Why IKEA attestation needed extra work

`CONFIG_TEST_ATTESTATION_TRUST_STORE` only has Chip-Test PAAs. IKEA production devices use VID **`0x117C`** (`IKEA of Sweden Matter PAA G1`). Without that root, commissioning dies at `AttestationVerification`.

OTBR images already have an `rcp_fw` SPIFFS partition. Mount PAA SPIFFS **by label `paa_cert`**, not “first SPIFFS”. The live patch is in `~/esp/esp-matter/components/esp_matter_controller/attestation_store/esp_matter_attestation_trust_store.cpp`.

Other vendors later: add their PAA `.der` from CSA DCL / CHIP `credentials/production/paa-root-certs`, rebuild the SPIFFS image, flash (no erase). See [COMMISSIONING.md](./COMMISSIONING.md#other-vendors).

---

## Do not do

- Pair IKEA / Apple / Google / Alexa **before** the CoreS3 (first fabric only).
- Wire bulbs or sensors into the K149.
- Tap Share Thread Network Credential on the factory GUI.
- `idf.py` with Homebrew Python 3.14 first on `PATH`.
- `sst deploy --stage int` for this work (firmware + these docs only).
- Commit dataset TLVs, PSKc, or setup codes.
- Six power cycles unless you intend a factory reset.

---

## Later (not done)

- Remaining IKEA: other KAJPLATS, Matter plug, remotes, then battery sensors.
- Skip Zigbee-only (PARASOLL / VALLHORN / old TRÅDFRI — no Matter logo).
- HomeHub `matter-gateway` device + AWS MQTT (`homehub_aws` publishes state and accepts commands).
- Cursor skill `homehub-cores3-commission` runs [COMMISSIONING.md](./COMMISSIONING.md) for each new device.
