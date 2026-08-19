# FireBeetle setup

Notes for the two **FireBeetle 2 ESP32-E** boards used with HomeHub. Wi‑Fi credentials live in `~/.zshrc.local` (not in git).

## Registered devices

| Label | MAC address | Hostname | Last IP | Wi‑Fi | Firmware | Status |
|-------|-------------|----------|---------|-------|----------|--------|
| FireBeetle #1 | `20:50:0d:b5:fc:a8` | `homehub-fb-b5fca8` | `192.168.0.36` | NOW216QN | `environmental-sensor-ota` | Cloud MQTT + 10 s VOC / 1–60 min publish; HTTP only in maintenance mode |
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

**SGP40 compensation:** firmware passes humidity and temperature from the env sensor into the SGP40 driver (`sgp40SetRhT`) and runs Sensirion’s Gas Index Algorithm at a **10 s** low-power cadence (local `sensirion_voc_algorithm` sources in the sketch folder).

**Libraries (Arduino):** `DFRobot_EnvironmentalSensor`, `ArduinoMqttClient`, `ArduinoJson` — installed automatically when compiling via `arduino-cli`. VOC uses the in-sketch SGP40 driver, not `DFRobot_SGP40`.

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

## HomeHub cloud (FireBeetle #1)

FireBeetle #1 publishes to HomeHub over **AWS IoT MQTT** with battery-efficient sampling:

- **10 s** low-power SGP40 VOC sampling (Wi-Fi and Bluetooth off between ticks)
- **Configurable cloud publish interval:** 1–60 minutes (default 5)
- Firmware publishes **metrics only** — HomeHub derives warning state from thresholds
- **Maintenance mode** in the UI keeps HTTP/OTA available after the next wake
- USB remains the recovery path if the board is asleep and OTA cannot connect

Canonical MQTT keys: `temperature`, `humidity`, `pressureHpa`, `lightLux`, `uvMwCm2`, `vocIndex`, `batteryVoltage`, `batteryPercent`.

### Register in HomeHub

1. Deploy the latest API/web (`pnpm deploy:int`).
2. **Devices → Register device**
   - Type: **Environmental sensor**
   - Runtime: **Physical device** (never starts a virtual MQTT client)
3. Wait until lifecycle **Ready**.
4. Set thresholds and reporting interval in the device accordion.

An interval change is stored immediately and applied when the sleeping device next connects (up to the previous interval).

Default thresholds: humidity **70%**, temperature **28°C**, VOC index **200**.

### Provision IoT credentials (one-time)

After the device is **Ready**:

```bash
source ~/.zshrc
SST_STAGE=int bash scripts/provision-esp-iot.sh firebeetle-1 <deviceId>
```

The script pulls `/homehub/devices/{deviceId}/cert|key|ca` from SSM into a mode-`0700` temp directory, writes `generated/iot_config.h`, compiles, OTA-flashes (USB fallback), and deletes secrets. Never commit that header.

If OTA times out, enable **Maintenance mode** in the UI and wait for the next publish wake, or flash over USB:

```bash
bash scripts/flash-esp-usb.sh firebeetle-1 environmental-sensor-ota
```

Without `HOMEHUB_IOT_ENABLED`, firmware still serves local HTTP (`bash scripts/read-esp-readings.sh firebeetle-1`).

### Wake sequence

1. Light-sleep ~10 s with Wi-Fi off; keep SGP40 powered and feed Sensirion’s algorithm.
2. First 45 s after cold boot: do not publish VOC (blackout).
3. When the reporting interval is due: read SEN0500 + battery, connect Wi-Fi, NTP, fetch Thing shadow, publish one QoS 1 reading, then sleep again.
4. If shadow `maintenanceMode=true`, stay awake for HTTP `/readings`, `/battery`, identify, and OTA.

### Int verification (2026-08-19)

- Physical device `01M0BMN0DMX5666GZPZPA6SWHD` reached `READY`; its simulator registry is `enabled: false`.
- First reading omitted `vocIndex` during blackout; later readings contained VOC indices 94–95.
- A temporary 60-second interval produced readings 65 seconds apart; the default was restored to 300 seconds.
- Lowering `temperatureWarning` to 20°C changed the next 27.1°C reading to `warning`; restoring 28°C changed the next reading back to `normal`.
- Maintenance mode enabled HTTP/OTA, and disabling it made HTTP unavailable again while cloud telemetry continued.
- The generated IoT header and temporary PEM files were absent after provisioning.

### Power measurement notes

Measure **whole-device** current from the battery (not ESP32 or sensor datasheet figures alone).

| State | How to measure | Datasheet / expected range |
|-------|----------------|----------------------------|
| Light sleep + sensors powered | Series ammeter on VBAT / JST, Wi-Fi off, 10 s ticks | ESP32 light sleep ~0.8–10 mA; Gravity shield + SEN0500 often dominate (typically **15–40 mA**) |
| ~170 ms VOC window | Scope or fast DMM on the same series path | SGP40 heater ~3–4 mA extra for tens of ms |
| Wi-Fi + MQTT publish | Same, during a 1-minute interval test | ESP32 TX typically **80–150 mA** for a few seconds |

**Bench (FireBeetle #1, Gravity shield + SEN0500 + SGP40):** a series meter was not on the battery rail during this iteration, so treat the ranges above as planning estimates. Do **not** add a GPIO-driven sensor-rail switch until a measured idle current is recorded.

If measured sleep current stays above ~20 mA:

1. Keep the **SGP40 rail powered** (VOC history is invalid if it power-cycles).
2. Add a load switch / MOSFET on the **SEN0500 rail only** (never power the stack directly from a GPIO).
3. Re-measure the three states and replace the estimates here.

**Estimated battery life** (2000 mAh LiPo, 5-minute publish, 10 s VOC, ~3 s Wi-Fi burst):

| Assumed sleep current | Approx. life |
|-----------------------|--------------|
| 5 mA (gated SEN0500) | 2–3 weeks |
| 20 mA (shield always on) | 3–5 days |
| 40 mA (worst idle) | 1–2 days |

Compare 10 s vs 1 s VOC only if measured quality or current requires it; **10 s remains the default**.

## Related docs

- [Hardware inventory](./hardware-inventory.md) — parts list and costs
- [Device simulator README](../packages/device-simulator/README.md) — Raspberry Pi hub / camera runtime
