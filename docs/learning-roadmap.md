# HomeHub learning roadmap

Phased plan for this project: **HomeHub cloud** + **Raspberry Pi hub** + **FireBeetle / ESP32-S3 spokes**, while learning **Grafana**, **AWS IoT Greengrass v2**, and **Kubernetes**.

Target architecture (end state):

```text
FireBeetle #1 ──Wi‑Fi──┐
FireBeetle #2 ──Wi‑Fi──┼──► Raspberry Pi (Greengrass v2 Core)
ESP32-S3 cam ──Wi‑Fi──┘         │
                                ├── local MQTT
                                ├── Greengrass components
                                └── AWS IoT Core ◄── HomeHub (cloud)
                                         │
                                    Grafana (metrics & dashboards)
```

Kubernetes is a **parallel track** (Mac/cloud lab) — not required on the Pi for Greengrass.

---

## Phase 0 — Done / in progress

| Step | Status | Notes |
|------|--------|-------|
| FireBeetle ×2 on home Wi‑Fi | Done | `.36` (#1), `.37` (#2) — see [FireBeetle setup](./firebeetle-setup.md) |
| FireBeetle #1 sensor firmware | Done | `environmental-sensor-ota` — env + SGP40 over HTTP; MQTT TBD |
| ESP32-S3 AI Camera on Wi‑Fi | Done | `.38` — see [ESP32-S3 camera setup](./esp32-s3-camera-setup.md) |
| ESP32 OTA (FireBeetle ×2 + S3) | Done | USB once, then `flash-esp-ota.sh` — see [FireBeetle setup](./firebeetle-setup.md) |
| CH340 driver + Arduino CLI on Mac | Done | `flash-esp-usb.sh`, `flash-esp-ota.sh`, `list-esp-devices.sh` |
| HomeHub int deployed | Project | https://homehub-int.apps.jarekwyprzal.com |

---

## Phase 1 — HomeHub basics (do this first)

**Goal:** One working camera in the app; understand MQTT, provisioning, and telemetry.

| # | Task | How |
|---|------|-----|
| 1.1 | Connect Pi to network | Ethernet or Wi‑Fi; note IP (expected ~`192.168.0.35`) |
| 1.2 | SSH to Pi | `ssh pi` — see [device simulator README](../packages/device-simulator/README.md) |
| 1.3 | Mount Camera Module 3 + pan/tilt | CSI ribbon + I2C for Arducam platform |
| 1.4 | Deploy device runtime | `pnpm sso` then `SST_STAGE=int pnpm device:deploy` |
| 1.5 | Register camera in HomeHub UI | Devices → Add → type **Camera** → wait for **Ready** |
| 1.6 | Verify snapshot / pan-tilt | Open device page; test controls |

**Learn:** AWS IoT thing + cert per device, SQS `DEVICE_READY`, MQTT telemetry, device shadow.

**Hardware used:** Raspberry Pi 5 kit, Camera Module 3, pan-tilt platform.

---

## Phase 2 — First spoke sensor (still direct to cloud)

**Goal:** One real sensor on a FireBeetle; still **not** Pi-as-gateway (matches HomeHub today).

| # | Task | Status | How |
|---|------|--------|-----|
| 2.1 | Stack IO shield on FireBeetle #1 | **Done** | Gravity cable to SEN0500 + SGP40 on same I2C bus |
| 2.2 | Wire multifunctional env sensor + SGP40 | **Done** | I2C `0x22` + `0x59`; env switch set to I2C — see [FireBeetle setup](./firebeetle-setup.md) |
| 2.3 | Flash sensor + Wi‑Fi + OTA firmware | **Done** | `environmental-sensor-ota` — `bash scripts/flash-esp-sensor-ota.sh firebeetle-1` |
| 2.4 | Verify local readings | **Done** | `bash scripts/read-esp-readings.sh firebeetle-1` |
| 2.5 | Register **Humidity sensor** in HomeHub UI | Todo | Devices → Add → type **Humidity sensor** |
| 2.6 | Publish telemetry to IoT Core | Todo | MQTT + device cert (same pattern as device simulator) |
| 2.7 | Optional: UI for pressure / VOC | Todo | Today humidity chart only for `humidity-sensor` type |

**Learn:** I2C on ESP32, JSON telemetry, thresholds in device config.

**Hardware used:** FireBeetle #1, IO shield, SEN0500 env sensor, SGP40 (BME280 / PIR / magnetic switch still available for **#2**).

**Optional:** FireBeetle #2 with a second role (e.g. door = magnetic switch); revert #2 to `wifi-connect-ota` until then.

---

## Phase 3 — Grafana (observability)

**Goal:** Dashboards and alerts on real device data.

| # | Task | How |
|---|------|-----|
| 3.1 | Pick hosting | **Grafana Cloud** (free tier) or local Docker on Mac/Pi |
| 3.2 | Choose data source | CloudWatch (AWS IoT / Lambda), Prometheus, or export from HomeHub readings |
| 3.3 | Build first dashboard | Camera online, FireBeetle RSSI, humidity (when Phase 2 done) |
| 3.4 | Add one alert | e.g. device offline > 5 min |

**Learn:** Panels, queries, labels, time range, alert rules.

**Does not require:** Greengrass or Kubernetes.

---

## Phase 4 — AWS IoT Greengrass v2 on Pi (edge hub)

**Goal:** Pi becomes **edge hub**; spokes talk to Pi locally; Pi syncs with AWS.

| # | Task | How |
|---|------|-----|
| 4.1 | Install Greengrass v2 on Pi | [AWS docs](https://docs.aws.amazon.com/greengrass/v2/developerguide/setting-up.html) — core device |
| 4.2 | Enable local MQTT (Moquette) | Greengrass nucleus + MQTT bridge |
| 4.3 | Point FireBeetles at Pi broker | Change firmware: MQTT to `192.168.0.x:1883` (or TLS) |
| 4.4 | Add Greengrass **component** | Port HomeHub camera runtime or a small forwarder |
| 4.5 | Deploy component via AWS | Greengrass deployments from console / CI |
| 4.6 | ESP32-S3 camera as spoke | Local MQTT → component, or keep as separate IoT client |

**Learn:** Core device, components, recipes, deployments, local shadows, IAM for edge.

**Hardware:** Pi 5 as core; FireBeetles + ESP32-S3 as spokes.

**Note:** HomeHub repo does not include Greengrass yet — this phase is **new infra**, likely a sibling repo or `infra/greengrass/` later.

---

## Phase 5 — Kubernetes (parallel lab, not on Pi first)

**Goal:** General K8s skills — separate from day-to-day Pi IoT.

| # | Task | How |
|---|------|-----|
| 5.1 | Local cluster | `minikube`, `kind`, or `k3d` on Mac |
| 5.2 | Deploy a sample app | Deployment + Service + Ingress |
| 5.3 | Run Grafana in cluster | Helm chart; connect to same data source as Phase 3 |
| 5.4 | Optional cloud | EKS free tier / small cluster — deploy HomeHub-adjacent tooling |

**Learn:** Pods, Deployments, Services, ConfigMaps, Secrets, Ingress.

**Avoid early on:** k3s **on the Pi** alongside Greengrass + camera + Docker — RAM gets tight.

---

## Phase 6 — Integrate & simplify (later)

| # | Task |
|---|------|
| 6.1 | Decide: HomeHub device runtime as Greengrass component vs keep standalone Docker |
| 6.2 | Single Grafana stack for cloud + edge metrics |
| 6.3 | Document spoke ↔ hub topic naming in repo |
| 6.4 | Cloud-managed OTA (AWS IoT jobs / signed URLs) — optional |

---

## Quick reference — what talks to what

| Phase | Pi role | FireBeetles | ESP32-S3 cam | HomeHub cloud |
|-------|---------|-------------|--------------|---------------|
| 1 | Camera runtime (Docker) | Wi‑Fi only | Wi‑Fi only | Camera device |
| 2 | Camera runtime | Direct IoT MQTT | Wi‑Fi only | Camera + sensor devices |
| 3 | + metrics in Grafana | Same | Same | Same |
| 4 | **Greengrass Core** | → local MQTT → Pi | → Pi or IoT | IoT + Greengrass sync |
| 5 | Unchanged for IoT | K8s lab on Mac/cloud | K8s lab | Optional EKS workloads |

---

## Inventory → phase mapping

| Purchased item | First used in |
|----------------|---------------|
| Raspberry Pi 5 + Camera Module 3 + pan-tilt | **Phase 1** |
| FireBeetle ×2 + IO shields | **Phase 2** (#1 deployed; #2 spare) |
| Multifunctional env sensor + SGP40 on #1 | **Phase 2** — firmware done; MQTT next |
| BME280, PIR, magnetic switch | **Phase 2** on FireBeetle #2 (pick one) |
| ESP32-S3 AI Camera (£19) | Phase 1 optional; **Phase 4** as second camera spoke |
| Batteries, enclosures | When mounting nodes permanently |
| LED switch | Phase 2+ (indicator on a FireBeetle) |

Full parts list: [Hardware inventory](./hardware-inventory.md).

---

## Commands cheat sheet

```bash
# Phase 1 — Pi camera
pnpm sso
SST_STAGE=int pnpm device:deploy
ssh pi

# Phase 2 — FireBeetle sensors (local HTTP today)
source ~/.zshrc && bash scripts/flash-esp-sensor-ota.sh firebeetle-1
bash scripts/read-esp-readings.sh firebeetle-1
bash scripts/identify-esp-device.sh firebeetle-1
curl http://192.168.0.36/i2c-scan

# Revert a board to Wi-Fi + OTA only (no sensor sketch)
bash scripts/flash-esp-ota.sh firebeetle-2 wifi-connect-ota

# List ESP devices on LAN
bash scripts/list-esp-devices.sh

# Legacy USB Wi-Fi-only
source ~/.zshrc && firebeetle-wifi

# Phase 2 — Re-flash ESP32-S3 camera
source ~/.zshrc && esp32s3-camera-wifi

# HomeHub UI
open https://homehub-int.apps.jarekwyprzal.com
```

---

## Related docs

- [Hardware inventory](./hardware-inventory.md)
- [FireBeetle setup](./firebeetle-setup.md)
- [ESP32-S3 camera setup](./esp32-s3-camera-setup.md)
- [Device simulator / Pi runtime](../packages/device-simulator/README.md)
- [Project README](../README.md)
