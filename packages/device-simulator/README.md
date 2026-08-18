# HomeHub device runtime

Python Docker container that long-polls the simulator SQS queue and runs one MQTT client per device. Sensor types emit virtual telemetry. `camera` devices capture JPEG stills (Camera Module 3) and drive the Arducam pan-tilt over I2C.

The container is **not** hosted on Lightsail. Deploy it to the Raspberry Pi with `pnpm device:deploy`, or run it locally with `pnpm dev:simulator`.

## What it does

- Receives `DEVICE_READY` / `DEVICE_STOP` messages from SQS (deviceId only — no secrets)
- Loads **per-device** X.509 certs from SSM (`/homehub/devices/{deviceId}/cert|key|ca`)
- Loads device config from DynamoDB (`SIMULATOR` registry + `DEVICE#` item)
- Connects to AWS IoT Core with the device-specific certificate
- Publishes telemetry to `homehub/devices/{deviceId}/telemetry`
- Subscribes to Device Shadow deltas and reports state
- For `camera`: `rpicam-still` → S3 snapshot + PCA9685 pan/tilt from shadow `configuration`

Certs are created automatically by the **DeviceProvision** Step Functions workflow when a device is registered.

## Raspberry Pi (`pnpm device:deploy`)

Builds `Dockerfile.pi` on the Pi over SSH (`Host pi` → `jarek@192.168.0.35`):

```bash
pnpm sso
pnpm device:deploy            # uses SST_STAGE or your personal stage
SST_STAGE=int pnpm device:deploy
```

The script enables GPIO I2C, installs Docker if needed, rsyncs this package, and runs `docker compose -f docker-compose.pi.yml up -d --build`.

## Local Mac (sensors only)

```bash
pnpm dev              # terminal 1 — personal stage
pnpm dev:simulator    # terminal 2 — slim image, no CSI/I2C
```

Camera capture no-ops when `rpicam-still` is missing; pan/tilt no-ops without `/dev/i2c-1`.

## Build image only

```bash
docker build -t homehub-device-simulator:latest .
docker build -f Dockerfile.pi -t homehub-device-simulator:pi .
```
