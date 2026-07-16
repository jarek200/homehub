# HomeHub device simulator

Python Docker container that long-polls the simulator SQS queue and runs one MQTT client per virtual device.

**Managed by SST** on `int` and `prod`: Lightsail Container Service + ECR (`infra/device-simulator.ts`). Personal `pnpm dev` stages use the local Docker simulator instead (`pnpm dev:simulator`).

## What it does

- Receives `DEVICE_READY` / `DEVICE_STOP` messages from SQS (deviceId only — no secrets)
- Loads **per-device** X.509 certs from SSM (`/homehub/devices/{deviceId}/cert|key|ca`)
- Loads device config from DynamoDB (`SIMULATOR` registry + `DEVICE#` item)
- Connects to AWS IoT Core with the device-specific certificate
- Publishes telemetry to `homehub/devices/{deviceId}/telemetry` (~10s interval)
- Subscribes to Device Shadow deltas and reports state

Certs are created automatically by the **DeviceProvision** Step Functions workflow when a device is registered.

## SST / Lightsail (int & prod only)

`pnpm deploy:int` / `pnpm deploy:prod` provision:

- ECR repository `homehub-device-simulator-{stage}`
- Lightsail Container Service `homehub-{stage}-simulator`
- IAM user + SSM parameters for container AWS credentials

CI rebuilds Lightsail only when simulator-related paths change. Locally, `pnpm simulator:deploy` skips if Lightsail is already ACTIVE. Force a rebuild:

```bash
HOMEHUB_FORCE_SIMULATOR_DEPLOY=true pnpm simulator:deploy
```

## Local dev (compose)

Personal `pnpm dev` stages do not create Lightsail. Run the simulator locally against the same personal stage:

```bash
pnpm dev              # terminal 1 — personal stage (OS username by default)
pnpm dev:simulator    # terminal 2 — reads SST_STAGE / same default
```

Or manually:

```bash
export TABLE_NAME=...
export SQS_QUEUE_URL=...
export IOT_ENDPOINT=https://...
docker compose up --build
```

## Build image only

```bash
docker build -t homehub-device-simulator:latest .
```

## Scaling

The PoC targets 1–10 virtual devices on a nano Lightsail container (512 MB). For 10→100 devices, increase `power` in `infra/stage-config.ts`, tune `reportingIntervalSeconds`, and run multiple reconciler containers with competing consumers on the same queue.
