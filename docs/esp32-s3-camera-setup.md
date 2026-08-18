# ESP32-S3 AI Camera Module

Standalone **edge AI camera** from [The Pi Hut](https://thepihut.com/) — DFRobot **DFR1154** ([wiki](https://wiki.dfrobot.com/dfr1154/)). Separate from the **Raspberry Pi Camera Module 3** hub camera.

| | |
|---|---|
| **Qty** | 1 |
| **Cost** | £19.10 |
| **SKU** | DFR1154 |
| **HomeHub status** | Wi‑Fi + OTA — see [Registered device](#registered-device) |

## What it is

All-in-one board: ESP32-S3 + OV3660 wide-angle IR camera + mic + speaker + ambient light sensor. Built for on-device image recognition (Edge Impulse, etc.) and Wi‑Fi IoT — not wired into HomeHub today.

```text
[USB-C or VIN power] → ESP32-S3 AI Camera Module
                              ├── OV3660 camera (160° FOV, night IR)
                              ├── PDM microphone
                              ├── Speaker (included)
                              └── Gravity UART (GPIO43/44) — optional sensor
```

## Specs (from DFRobot)

| Component | Detail |
|-----------|--------|
| MCU | ESP32-S3R8, dual-core 240 MHz |
| Flash / PSRAM | 16 MB / 8 MB |
| Camera | OV3660, ~3 MP, 160° FOV, visible + 940 nm IR |
| USB | **USB Type-C** — power + firmware (native USB, **no CH340 driver**) |
| VIN | 3.7–15 V DC (battery/LiPo) |
| Size | 42 × 42 mm |
| Extras | SD slot, IR LED (GPIO47), ALS (LTR-308), onboard LED (GPIO3) |

In the box: camera board, speaker, Gravity 4-pin I2C/UART cable.

## vs other HomeHub hardware

| Device | Role | Connection to Mac | HomeHub today |
|--------|------|-------------------|---------------|
| **ESP32-S3 AI Camera** | Standalone AI cam | USB-C (data) | Not integrated |
| **FireBeetle ESP32-E** ×2 | Sensor nodes | USB + CH340 driver | Wi‑Fi only (local) |
| **Raspberry Pi 5 + Cam Module 3** | Hub camera + pan/tilt | SSH over LAN | `pnpm device:deploy` |

## Mac setup (when you’re ready)

Unlike the FireBeetles, this board uses **native USB-C** — no CH340 driver.

1. **Arduino CLI** — already installed (see [FireBeetle setup](./firebeetle-setup.md)).
2. **Board package** — same `esp32:esp32` core; select **ESP32S3 Dev Module**.
3. **USB mode** — in Arduino IDE / CLI, often needs **USB CDC On Boot: Enabled** for serial over Type-C.
4. **Port** — expect `/dev/cu.usbmodem*` (not `wchusbserial*`).

## Flash firmware (USB first, then OTA)

Shared OTA sketch and device registry with FireBeetle — see [FireBeetle setup](./firebeetle-setup.md#firmware).

### USB flash (first time or recovery)

```bash
source ~/.zshrc   # WIFI_SSID, WIFI_PASSWORD, ESP32_OTA_PASSWORD
bash scripts/flash-esp-usb.sh esp32s3-cam
```

Override port: `ESP32S3_PORT=/dev/cu.usbmodem101 bash scripts/flash-esp-usb.sh esp32s3-cam`

Board FQBN (set by script): `esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc,FlashSize=16M,PartitionScheme=default_8MB`

### OTA flash (no USB cable)

Leave the board on a **USB charger or battery** after the first USB flash.

```bash
source ~/.zshrc
bash scripts/list-esp-devices.sh
bash scripts/flash-esp-ota.sh esp32s3-cam
```

### Legacy Wi‑Fi-only script

`scripts/flash-esp32s3-camera-wifi.sh` — scan/connect without OTA.

```bash
source ~/.zshrc
esp32s3-camera-wifi
```

Serial monitor (may need replug after flash):

```bash
arduino-cli monitor -p /dev/cu.usbmodem101 -c baudrate=115200
```

Verify on LAN: `arp -a | rg 28:84:85`

**Tip:** Use a **data** USB-C cable (same rule as FireBeetle). Bottom USB-C port on Mac Air if the top one has the charger.

## Wi‑Fi

Same home network as the FireBeetles. Credentials are in `~/.zshrc.local`:

- `WIFI_SSID` → `NOW216QN`
- `WIFI_PASSWORD` → (local only)

DFRobot wiki has Wi‑Fi + camera example sketches; HomeHub AWS IoT firmware is still TBD.

## Physical connections

| Purpose | How |
|---------|-----|
| First flash / debug | USB-C → Mac |
| Portable / installed | VIN 3.7–15 V (e.g. 2000 mAh LiPo from inventory) |
| Extra sensor | Gravity cable on **43 (TX) / 44 (RX)** — 3.3 V only on V1.1 boards |
| Audio | Speaker already connects to SPK (MX1.25) |

**Do not** feed 5 V into Gravity **+** on V1.1 — it is **3.3 V output** only.

## Suggested first steps

1. Plug in **USB-C** → confirm `/dev/cu.usbmodem*` appears.
2. In Arduino IDE: **ESP32S3 Dev Module**, **USB CDC On Boot: Enabled**.
3. Run DFRobot **Wi‑Fi scan** or **camera capture** example from [DFR1154 wiki](https://wiki.dfrobot.com/dfr1154/).
4. Join **NOW216QN** (2.4 GHz) using the same credentials as FireBeetle.
5. Later: decide if this cam joins HomeHub as a second `camera` device or stays standalone AI.

## Registered device

| Field | Value |
|-------|-------|
| Label | ESP32-S3 AI Camera |
| Alias | `esp32s3-cam` |
| SKU | DFR1154 |
| MAC address | `28:84:85:4c:80:08` |
| Hostname | `homehub-s3-4c8008` |
| Last IP | `192.168.0.38` |
| Wi‑Fi | NOW216QN |
| USB port (Mac) | `/dev/cu.usbmodem101` |
| Firmware | `wifi-connect-ota` |
| Status | **Wi‑Fi + OTA** |

IPs may change after router reboot; MAC is fixed.

## Related docs

- [Hardware inventory](./hardware-inventory.md)
- [FireBeetle setup](./firebeetle-setup.md) — shared Wi‑Fi creds and Arduino CLI
- [Device simulator README](../packages/device-simulator/README.md) — Pi Camera Module 3 runtime
