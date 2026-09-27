# Timer Camera F setup

Always-on **M5Stack Timer Camera F** plus Grove **Unit PIR (AS312)**. First flash is USB; later updates use LAN ArduinoOTA.

| | |
|---|---|
| Alias | `timer-cam-f` |
| MAC | from `devices.conf` (copy `devices.conf.example`) |
| Hostname | from `devices.conf` |
| USB | `TIMER_CAM_F_PORT`, or the first `/dev/cu.usbserial*` device |
| Board | `esp32:esp32:m5stack_timer_cam` — 4 MB flash, PSRAM, **default OTA partitions** |
| Sketch | `firmware/timer-camera/timer-camera-f` |
| PIR | Grove HY2.0-4P — white / SCL = **GPIO 13** |

Do not use a 16 MB `huge_app` FQBN (that layout has no OTA slot).

## First flash (USB)

```bash
source ~/.zshrc   # WIFI_SSID, WIFI_PASSWORD, ESP32_OTA_PASSWORD
bash scripts/firmware/flash-esp-usb.sh timer-cam-f
```

Serial should show `MAC`, `IP address`, and `Ready for OTA`.

Local checks:

```text
GET http://<ip>/status
GET http://<ip>/snapshot
GET http://<ip>/capture
```

Wave a hand in front of the PIR — `/status` `motionActive` should go true and a new JPEG should appear.

## Later flashes (OTA, no USB)

Leave the camera on USB power.

```bash
source ~/.zshrc
bash scripts/firmware/list-esp-devices.sh
bash scripts/firmware/flash-esp-ota.sh timer-cam-f
```

Override USB port: `TIMER_CAM_F_PORT=/dev/cu.usbserial-XXXXXXXX bash scripts/firmware/flash-esp-usb.sh timer-cam-f`.

## Cloud (AWS IoT + S3 snapshots)

1. Add a **physical camera** in HomeHub (`https://homehub.example.com/devices`) and wait until lifecycle is `READY`.
2. Provision certs and cloud firmware:

```bash
source ~/.zshrc
SST_STAGE=int bash scripts/provisioning/provision-esp-iot.sh timer-cam-f <deviceId>
```

This writes `iot_config.h` (Thing cert, credentials endpoint, role alias `homehub-int-camera-s3`, snapshot bucket) and OTA-flashes the camera. JPEGs go to the private `homehub-snapshots-int` bucket; MQTT carries `snapshotKey` and `occupied` only.

Take Snapshot in the camera panel PATCHes `configuration.captureNow`. The camera captures once and reports the same id.
