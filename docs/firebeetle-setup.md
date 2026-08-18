# FireBeetle setup

Notes for the two **FireBeetle 2 ESP32-E** boards used with HomeHub. Wi‑Fi credentials live in `~/.zshrc.local` (not in git).

## Registered devices

| Label | MAC address | Hostname | Last IP | Wi‑Fi | Firmware | Status |
|-------|-------------|----------|---------|-------|----------|--------|
| FireBeetle #1 | `20:50:0d:b5:fc:a8` | `homehub-fb-b5fca8` | `192.168.0.36` | NOW216QN | `environmental-sensor-ota` | Wi‑Fi + OTA + **both I2C sensors** |
| FireBeetle #2 | `20:50:0d:b6:64:50` | `homehub-fb-b66450` | `192.168.0.37` | NOW216QN | `environmental-sensor-ota` | Wi‑Fi + OTA — **no sensors wired** (revert to `wifi-connect-ota` if desired) |

IPs may change after router reboot; MAC addresses are fixed — use them to tell boards apart. Device registry: [`devices.conf`](../packages/firebeetle-firmware/devices.conf).

### Tell boards apart

| Method | Command |
|--------|---------|
| LED blink pattern | `bash scripts/identify-esp-device.sh firebeetle-1` — **#1 = fast blink**, **#2 = slow blink** |
| MAC on PCB | Match printed MAC to the table above |
| Sensors attached | Only **#1** has the Gravity IO shield + env sensor + SGP40 |

## Home network

| Setting | Value |
|---------|-------|
| SSID | `NOW216QN` |
| Band | 2.4 GHz (required for ESP32) |
| Password | `~/.zshrc.local` → `WIFI_PASSWORD` |

## Mac dev setup (one-time)

| Step | Detail |
|------|--------|
| USB chip | CH340 (shows as **USB Serial**) |
| Driver | WCH **CH34xVCPDriver** → `/Applications/CH34xVCPDriver.app` |
| Serial port | `/dev/cu.wchusbserial10` (when one board is plugged in) |
| Flash tool | `arduino-cli` + `esp32:esp32:esp32` board package |
| Shell secrets | `~/.zshrc.local` exports `WIFI_SSID`, `WIFI_PASSWORD`, `ESP32_OTA_PASSWORD` |

Enable the driver extension under **System Settings → General → Login Items & Extensions → Driver Extensions**.

Add OTA password to `~/.zshrc.local` (see [`packages/firebeetle-firmware/.env.example`](../packages/firebeetle-firmware/.env.example)):

```bash
export ESP32_OTA_PASSWORD='your-home-lan-ota-password'
```

## Firmware

| Sketch | Path | Purpose |
|--------|------|---------|
| Wi‑Fi scan | `packages/firebeetle-firmware/wifi-scan/` | List nearby networks |
| Wi‑Fi connect | `packages/firebeetle-firmware/wifi-connect/` | Join home Wi‑Fi (legacy, no OTA) |
| **Wi‑Fi + OTA** | `packages/firebeetle-firmware/wifi-connect-ota/` | Join Wi‑Fi and accept LAN firmware updates |
| **Environmental sensors** | `packages/firebeetle-firmware/environmental-sensor-ota/` | Wi‑Fi + OTA + I2C env sensor + SGP40 VOC |

### FireBeetle #1 — sensor wiring (I2C)

Both sensors share one I2C bus via the **Gravity IO shield** (SDA/SCL breakout):

| Sensor | SKU | I2C address | Readings |
|--------|-----|-------------|----------|
| Multifunctional Environmental Sensor | SEN0500/SEN0501 | `0x22` | temp, humidity, pressure, light, UV |
| SGP40 Air Quality | SEN0392 | `0x59` | `voc_index` (0–500; higher = worse air) |

**Env sensor switch:** set onboard **MODESWITCH to I2C** (firmware expects I2C, not UART). Gravity cables: red=VCC, black=GND, blue=SDA, yellow=SCL.

**SGP40 compensation:** firmware passes humidity and temperature from the env sensor into the SGP40 library (`setRhT`) for more accurate VOC index.

**Libraries (Arduino):** `DFRobot_EnvironmentalSensor`, `DFRobot_SGP40` — installed automatically when compiling via `arduino-cli`.

### HTTP endpoints (`environmental-sensor-ota`)

| Path | Description |
|------|-------------|
| `GET /readings` | JSON: env fields + `voc_index`, `sensor_ready`, `voc_ready`, `voc_warming`, `valid` |
| `GET /i2c-scan` | Devices seen on the bus (expect `0x22` and `0x59` on #1) |
| `GET /identify?seconds=20` | Blink onboard LED (fast on #1, slow on #2) |
| `GET /battery` | LiPo voltage and rough percent (FireBeetle VBAT on GPIO 34) |

Example readings:

```bash
bash scripts/read-esp-readings.sh firebeetle-1
# temperature_c, humidity, pressure_hpa, light_lux, uv_mw_cm2, voc_index, battery_v, ...
```

**VOC index bands** (Sensirion algorithm via DFRobot library):

| Range | Meaning |
|-------|---------|
| 0–100 | Good — no action needed |
| 100–200 | OK |
| 200–400 | Consider ventilating |
| 400–500 | Ventilate / purify strongly |

Sensor init runs in the **background** after Wi‑Fi comes up (~10 s SGP40 warmup). HTTP and OTA stay responsive during warmup.

### USB flash (first time or recovery)

Plug in **one** FireBeetle at a time. Match the **MAC** printed in serial output to the row above before unplugging.

```bash
source ~/.zshrc   # WIFI_SSID, WIFI_PASSWORD, ESP32_OTA_PASSWORD
bash scripts/flash-esp-usb.sh firebeetle-1
bash scripts/flash-esp-usb.sh firebeetle-2
bash scripts/flash-esp-usb.sh firebeetle-1 environmental-sensor-ota   # sensor firmware
```

Override port if needed: `FIREBEETLE_PORT=/dev/cu.wchusbserial10 bash scripts/flash-esp-usb.sh firebeetle-1`

### OTA flash (no USB cable)

Board must stay **powered** (USB charger or battery) and on `NOW216QN`. Mac on the same LAN.

```bash
source ~/.zshrc
bash scripts/list-esp-devices.sh              # MAC → current IP
bash scripts/flash-esp-ota.sh firebeetle-1    # wifi-connect-ota (default)
bash scripts/flash-esp-sensor-ota.sh firebeetle-1   # environmental-sensor-ota
bash scripts/flash-esp-ota.sh firebeetle-1 environmental-sensor-ota   # same, explicit sketch
bash scripts/flash-esp-ota.sh all             # all registered devices
```

Upload resolves IP from MAC (not mDNS). If `arduino-cli` fails, scripts fall back to `espota.py`.

**Sensor firmware on a board without sensors:** flash `wifi-connect-ota` on FireBeetle #2 to avoid bogus `/readings` when nothing is wired:

```bash
bash scripts/flash-esp-ota.sh firebeetle-2 wifi-connect-ota
```

### Read sensors and battery

```bash
bash scripts/read-esp-readings.sh firebeetle-1   # env + VOC (sensor firmware)
bash scripts/read-esp-battery.sh firebeetle-1    # battery only (any OTA firmware)
curl http://192.168.0.36/i2c-scan                # verify 0x22 + 0x59
bash scripts/identify-esp-device.sh firebeetle-1 # fast LED blink
```

Battery: VBAT via onboard divider on **GPIO 34**. Percent is a rough LiPo estimate (3.3 V = 0%, 4.2 V = 100%).

### Legacy Wi‑Fi-only scripts

`scripts/flash-firebeetle-wifi.sh` — scan/connect without OTA (superseded by `flash-esp-usb.sh` for normal use).

```bash
# Scan (no password needed)
bash scripts/flash-firebeetle-wifi.sh scan

# Connect (uses WIFI_SSID / WIFI_PASSWORD from shell)
source ~/.zshrc
firebeetle-wifi
```

Serial monitor:

```bash
arduino-cli monitor -p /dev/cu.wchusbserial10 -c baudrate=115200
```

## What persists after unplugging

| Item | Persists? |
|------|-----------|
| CH340 driver on Mac | Yes |
| Firmware + Wi‑Fi creds on board | Yes (flash memory) |
| Auto-reconnect to NOW216QN | Yes on power-up |
| IP address | May change (DHCP) |

Re-flash over USB when changing Wi‑Fi creds, recovering from a bad OTA image, or first-time setup. Day-to-day firmware changes use **OTA** (`flash-esp-ota.sh`).

## OTA troubleshooting

| Problem | Fix |
|---------|-----|
| Port not found (USB) | Only one board plugged in; enable CH340 driver |
| OTA timeout / device offline | Run `list-esp-devices.sh`; board needs power + Wi‑Fi |
| HTTP hangs after sensor flash | Old builds blocked in `setup()` during SGP40 warmup — flash latest `environmental-sensor-ota` via USB, or unplug SGP40, power-cycle, OTA, replug |
| `/readings` valid:false, nonsense values | I2C not connected — check Gravity cables and env sensor **I2C/UART switch** |
| I2C scan empty (`addresses: []`) | Same as above; confirm shield stacking and 3.3 V power |
| Wrong FireBeetle flashed | Match serial **MAC** or run `identify-esp-device.sh` |
| `port not found` (network) | Script retries via `espota.py`; check router AP isolation |
| `ESP32_OTA_PASSWORD` missing | Add to `~/.zshrc.local` (see `.env.example`) |

## Not yet connected to HomeHub cloud

FireBeetle #1 publishes readings over **local HTTP** only. **AWS IoT MQTT** registration (device cert from SSM, telemetry topics, Humidity sensor type in the UI) is the next step — see [Learning roadmap](./learning-roadmap.md) Phase 2. The Pi hub runs the camera runtime separately.

## Related docs

- [Hardware inventory](./hardware-inventory.md) — parts list and costs
- [Device simulator README](../packages/device-simulator/README.md) — Raspberry Pi hub / camera runtime
