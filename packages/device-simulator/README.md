# HomeHub device simulator

Python Docker container that long-polls the simulator SQS queue and runs one MQTT client per virtual device. Deploy on a Lightsail instance (or locally via Docker Compose) — not managed by SST.

## What it does

- Receives `DEVICE_READY` / `DEVICE_STOP` messages from SQS
- Loads device config from DynamoDB (`SIMULATOR` registry + `DEVICE#` item)
- Connects to AWS IoT Core with X.509 certs
- Publishes telemetry to `homehub/devices/{deviceId}/telemetry` (~60s interval)
- Subscribes to Device Shadow deltas and reports state

## Prerequisites

- DynamoDB table + SQS queue (from `pnpm deploy:int`)
- IoT policy attached to the simulator **certificate** principal
- Certs mounted at `/certs` or stored in SSM Parameter Store:
  - `/homehub/simulator/cert` (`SecureString`)
  - `/homehub/simulator/key` (`SecureString`)
  - `/homehub/simulator/ca`

## Build

```bash
docker build -t homehub-device-simulator:latest .
```

## Run on Lightsail

Instance IAM role needs:

- `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`
- `dynamodb:GetItem`
- `iot:Connect`, `iot:Publish`, `iot:Subscribe`, `iot:Receive`
- `ssm:GetParameter` on `/homehub/simulator/*` (if not mounting certs)

```bash
docker run -d --restart unless-stopped \
  -v /opt/homehub/certs:/certs:ro \
  -e TABLE_NAME=<from sst output> \
  -e SQS_QUEUE_URL=<from sst output> \
  -e AWS_REGION=eu-west-2 \
  -e IOT_ENDPOINT=https://<id>.iot.eu-west-2.amazonaws.com \
  homehub-device-simulator:latest
```

## Local dev (compose)

```bash
export TABLE_NAME=...
export SQS_QUEUE_URL=...
export IOT_ENDPOINT=https://...
export CERT_HOST_DIR=./certs
docker compose up --build
```

## Scaling

The PoC targets 1–10 virtual devices on a £8/month Lightsail (1 GB RAM). For 10→100 devices, increase instance size, tune `reportingIntervalSeconds`, and run multiple reconciler containers with competing consumers on the same queue.
