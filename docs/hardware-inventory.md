# Hardware Inventory

Purchased components for HomeHub and related IoT projects. Source: [The Pi Hut](https://thepihut.com/).

## Summary

| Metric | Value |
|--------|-------|
| Line items | 19 |
| Total units | 26 |
| **Total cost** | **£492.80** |

---

## Microcontrollers & boards

| Item | Qty | Unit price | Total | Notes |
|------|-----|------------|-------|-------|
| FireBeetle 2 ESP32-E IoT Microcontroller (N16R2) | 2 | £13.10 | £26.20 | Onboard PCB antenna |
| ESP32-S3 AI Camera Module | 1 | £19.10 | £19.10 | |
| Raspberry Pi 5 Starter Kit | 1 | £221.40 | £221.40 | 8GB / UK |

## Sensors

| Item | Qty | Unit price | Total | Notes |
|------|-----|------------|-------|-------|
| Gravity: Multifunctional Environmental Sensor | 1 | £28.80 | £28.80 | DFRobot |
| Gravity: SGP40 Air Quality Sensor | 1 | £13.40 | £13.40 | DFRobot |
| BME280 Environmental Sensor | 1 | £8.70 | £8.70 | Waveshare |
| Gravity: Digital PIR (Motion) Sensor for Arduino | 1 | £4.80 | £4.80 | DFRobot |
| PIR Motion Sensor Module | 1 | £3.00 | £3.00 | |
| Magnetic Switch | 1 | £4.40 | £4.40 | DFRobot |

## Actuators & switches

| Item | Qty | Unit price | Total | Notes |
|------|-----|------------|-------|-------|
| Gravity: LED Switch - Green | 1 | £4.40 | £4.40 | |

## Shields & expansion

| Item | Qty | Unit price | Total | Notes |
|------|-----|------------|-------|-------|
| Gravity: IO Shield for FireBeetle M0 and ESP32-E | 2 | £4.80 | £9.60 | DFRobot |
| FireBeetle Covers - Gravity I/O Expansion Shield | 2 | £5.40 | £10.80 | DFRobot |

## Camera

| Item | Qty | Unit price | Total | Notes |
|------|-----|------------|-------|-------|
| Raspberry Pi Camera Module 3 | 1 | £24.00 | £24.00 | Standard |
| Upgraded Pan Tilt Platform for Official Raspberry Pi Camera Module | 1 | £26.00 | £26.00 | Arducam |

## Power

| Item | Qty | Unit price | Total | Notes |
|------|-----|------------|-------|-------|
| 18650 Lithium-ion Rechargeable Cell - 3000mAh 3.7V 15A | 2 | £7.00 | £14.00 | |
| 2000mAh 3.7V LiPo Battery | 2 | £10.00 | £20.00 | JST-PH connector |
| 2-Way 18650 Battery Holder | 1 | £10.20 | £10.20 | DFRobot |

## Enclosures

| Item | Qty | Unit price | Total | Notes |
|------|-----|------------|-------|-------|
| General-Purpose Project Enclosure - 120×65×40 mm | 1 | £3.70 | £3.70 | CamdenBoss |
| General-Purpose Project Enclosure - 85×56×39 mm | 2 | £3.60 | £7.20 | CamdenBoss |

---

## Full list (purchase order)

1. Gravity: LED Switch - Green — 1× — £4.40
2. General-Purpose Project Enclosure - 120×65×40 mm (CamdenBoss) — 1× — £3.70
3. 18650 Lithium-ion Rechargeable Cell - 3000mAh 3.7V 15A — 2× — £14.00
4. General-Purpose Project Enclosure - 85×56×39 mm (CamdenBoss) — 2× — £7.20
5. 2-Way 18650 Battery Holder (DFRobot) — 1× — £10.20
6. Gravity: IO Shield for FireBeetle M0 and ESP32-E (DFRobot) — 2× — £9.60
7. ESP32-S3 AI Camera Module — 1× — £19.10
8. Gravity: Multifunctional Environmental Sensor (DFRobot) — 1× — £28.80
9. Magnetic Switch (DFRobot) — 1× — £4.40
10. Gravity: SGP40 Air Quality Sensor (DFRobot) — 1× — £13.40
11. Gravity: Digital PIR (Motion) Sensor for Arduino (DFRobot) — 1× — £4.80
12. FireBeetle Covers - Gravity I/O Expansion Shield (DFRobot) — 2× — £10.80
13. 2000mAh 3.7V LiPo Battery (JST-PH) — 2× — £20.00
14. FireBeetle 2 ESP32-E IoT Microcontroller (N16R2) — 2× — £26.20
15. Raspberry Pi Camera Module 3 (Standard) — 1× — £24.00
16. BME280 Environmental Sensor (Waveshare) — 1× — £8.70
17. Upgraded Pan Tilt Platform for Official Raspberry Pi Camera Module (Arducam) — 1× — £26.00
18. PIR Motion Sensor Module — 1× — £3.00
19. Raspberry Pi 5 Starter Kit (8GB / UK) — 1× — £221.40

---

## Setup notes

| Device | Doc | Status |
|--------|-----|--------|
| FireBeetle #1 (`b5:fc:a8`) | [FireBeetle setup](./firebeetle-setup.md) | Physical **Environmental sensor** — 10 s VOC, 1–60 min MQTT; HTTP/OTA in maintenance mode |
| FireBeetle #2 (`b6:64:50`) | [FireBeetle setup](./firebeetle-setup.md) | `environmental-sensor-ota` flashed; **no sensors wired** — spare for PIR / door / BME280 |
| ESP32-S3 AI Camera Module (DFR1154) | [ESP32-S3 camera setup](./esp32-s3-camera-setup.md) | Physical **Camera** on int — `esp32s3-camera-cloud`, 30 s snapshots |
| Raspberry Pi 5 + Camera Module 3 | [Device simulator README](../packages/device-simulator/README.md) | Hub camera via `pnpm device:deploy` |

### FireBeetle #1 — what's on the bench

| Component | Role |
|-----------|------|
| Gravity IO shield | I2C breakout (GPIO 21 SDA, 22 SCL) |
| Multifunctional Environmental Sensor (SEN0500) | Temp, humidity, pressure, light, UV |
| SGP40 Air Quality (SEN0392) | VOC index (0–500), RH/T compensated from env sensor |
| 18650 / LiPo (optional) | Battery monitoring via `/battery` |

Local readings (maintenance / unprovisioned): `bash scripts/read-esp-readings.sh firebeetle-1`. Cloud: register as **Environmental sensor (physical)**, then `SST_STAGE=int bash scripts/provision-esp-iot.sh firebeetle-1 <deviceId>`.

ESP32-S3 camera: register as **Camera (physical)**, then `SST_STAGE=int bash scripts/provision-esp-iot.sh esp32s3-cam <deviceId>`.

**Learning path (what first, then next):** [Learning roadmap](./learning-roadmap.md)
