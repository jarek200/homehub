# HomeHub — Smart Home IoT Hub

HomeHub is a smart-home device management platform built for a technical interview task: a **RESTful IoT API**, persistent state, error handling, infrastructure-as-code, and a **stretch frontend** for managing devices remotely.

It also includes a lightweight **home issues** layer (inspired by housing IoT case workflows) where high humidity readings can automatically raise actionable issues.

## What this delivers

| Interview requirement | Implementation |
|---|---|
| Register a device | `POST /devices` |
| List all devices | `GET /devices` |
| Get device details | `GET /devices/{deviceId}` |
| Update device status/config | `PATCH /devices/{deviceId}` |
| Delete a device | `DELETE /devices/{deviceId}` |
| State + history storage | DynamoDB single-table design |
| Error handling | `400` validation errors, `404` not found, consistent JSON error shape |
| Stretch frontend | SvelteKit console (Cognito auth + REST API) |
| IaC deployment | SST v4 (Lambda + API Gateway + DynamoDB + Cognito) |

## Architecture

```
Reviewers / curl                HomeHub web app (SvelteKit)
       |                                  |
       | X-Api-Key                        | Cognito JWT
       v                                  v
              REST API (API Gateway HTTP)
                         |
                         v
                 DynamoDB (single table)
```

- **REST API** — the only backend surface. Device/issue data lives on a demo tenant (`HUB#demo`). Reviewers can `curl` with `X-Api-Key`; the signed-in UI sends a Cognito ID token.
- **Cognito** — sign up / sign in for the web app. User profiles live under `USER#...`.
- **DynamoDB** — shared storage using composite `PK` / `SK` keys. Demo devices are seeded on first deploy via `demo_seed.py`.
- **SST v4** — infrastructure in [`sst.config.ts`](sst.config.ts) and [`infra/`](infra/).

## Tech stack

- **Frontend**: SvelteKit 2, TypeScript, Tailwind CSS, Amplify Auth (Cognito only)
- **REST API**: FastAPI on AWS Lambda (Python 3.13) via API Gateway HTTP API
- **Database**: DynamoDB
- **Monorepo**: pnpm workspaces + Turborepo
- **Validation / tests**: Pydantic + pytest (REST), Vitest (shared TS types)

## Prerequisites

- Node.js 24
- pnpm
- Python 3.13 + [uv](https://docs.astral.sh/uv/) (for the FastAPI REST API)
- AWS CLI with SSO (for deploy / `sst dev`)

## Quick start

```bash
nvm use
pnpm install
uv sync --all-packages   # install Python deps for the REST API Lambda (required for sst dev)
pnpm sso          # AWS SSO login
pnpm dev          # SST dev mode (deploys stack + runs web app)
```

For frontend-only local work against an already-deployed backend:

```bash
pnpm dev:local
```

## REST API

After `pnpm dev` or `pnpm deploy:int`, SST prints `restApiUrl`. Device endpoints use the demo tenant.

Set the base URL once:

```bash
export REST_API_URL="https://your-api-id.execute-api.region.amazonaws.com"
```

### Register a device

```bash
curl -s -X POST "$REST_API_URL/devices" \
  -H "Content-Type: application/json" \
  -d '{"name":"Living Room Camera","type":"security-camera","location":"Living Room","configuration":"{\"motionDetection\":true}"}'
```

Returns the full device including a server-generated ULID as `deviceId`.

### List devices

```bash
curl -s "$REST_API_URL/devices"
```

### Get device details

```bash
curl -s "$REST_API_URL/devices/{deviceId}"
```

### Update device status / configuration

```bash
curl -s -X PATCH "$REST_API_URL/devices/{deviceId}" \
  -H "Content-Type: application/json" \
  -d '{"status":"ONLINE","configuration":"{\"power\":\"on\",\"brightness\":80}"}'
```

### Delete a device

```bash
curl -s -X DELETE "$REST_API_URL/devices/{deviceId}"
```

### Record a sensor reading

```bash
curl -s -X POST "$REST_API_URL/devices/{deviceId}/readings" \
  -H "Content-Type: application/json" \
  -d '{"temperature":21.5,"humidity":74}'
```

Readings with humidity ≥ 70% automatically create an open home issue (if none exists for that device).

### List readings

```bash
curl -s "$REST_API_URL/devices/{deviceId}/readings"
```

### Send a remote command

```bash
curl -s -X POST "$REST_API_URL/devices/{deviceId}/commands" \
  -H "Content-Type: application/json" \
  -d '{"command":"capture-image"}'
```

### List commands

```bash
curl -s "$REST_API_URL/devices/{deviceId}/commands"
```

### Home issues (stretch)

```bash
curl -s "$REST_API_URL/issues"
curl -s -X POST "$REST_API_URL/issues" \
  -H "Content-Type: application/json" \
  -d '{"title":"Condensation in bedroom","severity":"HIGH","status":"OPEN"}'
```

### User profile (web app)

```bash
# Requires Cognito ID token from a signed-in session
curl -s "$REST_API_URL/me" -H "Authorization: Bearer $ID_TOKEN"
curl -s -X PATCH "$REST_API_URL/me" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Jarek","bio":"HomeHub demo"}'
```

### Authentication

| Client | Header |
|---|---|
| Reviewer curl | `X-Api-Key: your-review-key` (when `REST_API_KEY` is set at deploy) |
| Web app | `Authorization: Bearer <Cognito ID token>` |

Set `REST_API_KEY` before deploy to require the key for curl:

```bash
REST_API_KEY=your-review-key pnpm deploy:int
curl -s "$REST_API_URL/devices" -H "X-Api-Key: your-review-key"
```

## Web app (stretch frontend)

1. Open the deployed web URL (or local dev URL from SST).
2. Sign up / sign in with Cognito.
3. Use **Devices** to register, view, update, toggle on/off, and delete IoT devices.
4. Use **Issues** to track home problems raised from sensor data.
5. Use **Account** to edit your profile.

## Project structure

```
apps/web/                  SvelteKit console (devices, issues, account)
packages/rest-api/         FastAPI REST API (Python, interview deliverable)
packages/core/             Shared TypeScript domain types
packages/functions/        Node.js Lambdas (Cognito post-confirmation)
infra/                     SST modules (auth, storage, REST API)
sst.config.ts              Infrastructure entry point
```

## Assumptions

1. **REST is the only API surface** — matches the interview brief directly.
2. **Demo tenant for devices** — Reviewer/device data lives under `HUB#demo`; user profiles under `USER#...`.
3. **Device IDs are ULIDs** — server-generated, time-sortable; `createdAt` / `updatedAt` remain explicit fields.
4. **Device types are free-form strings** — e.g. `smoke-alarm`, `environmental-sensor`.
5. **Configuration is JSON stored as a string** — flexible for different device models.
6. **Commands are queued as `PENDING`** — no real device firmware integration in this task.
7. **Home issues are a stretch feature** — simplified case tracking, not full housing compliance software.

## Approach and challenges

**Approach**

- Reused the existing SST monorepo to show production-style IaC thinking.
- Implemented the graded REST surface in **Python + FastAPI**, deployed to Lambda with Mangum.
- Kept **Cognito + Svelte** as the stretch frontend; the UI calls REST with JWT, reviewers use curl with API key.
- Moved shared domain types to `@sst-monorepo/core`.

**Challenges**

- **Dual auth on one API** — JWT for the UI, API key for curl; both hit the same FastAPI routes.
- **FastAPI on Lambda** — Mangum adapts API Gateway HTTP API events to ASGI; a single `$default` route lets FastAPI own all path routing.
- **Profile vs demo tenant** — `/me` is user-scoped; devices/issues use the demo tenant for the interview task.

## QA

```bash
pnpm verify    # lint, typecheck, test, build
pnpm test      # Vitest + pytest
```

Tests cover:

- FastAPI device CRUD (create, list, get, patch, delete) including 404/400 paths
- Readings and commands (create, list) plus humidity-triggered issue creation
- Issues CRUD and resolve flow
- Humidity threshold helpers via Vitest

## Deploy (optional)

```bash
pnpm sso
pnpm deploy:int
```

SST outputs:

- `restApiUrl` — REST device API
- `webUrl` — SvelteKit app
- `userPoolId` / `userPoolClientId` — Cognito
- `simulatorQueueUrl` — SQS queue for the Docker simulator
- `iotEndpoint` — IoT Core data endpoint (ATS)
- `telemetryBucket` — S3 bucket for raw Parquet telemetry

## IoT provision PoC (stretch)

The interview REST API and Svelte console work without Lightsail. The stretch path adds async provisioning and live MQTT telemetry.

### Flow

1. `POST /devices` writes `lifecycleStatus=PROVISIONING` to DynamoDB.
2. DynamoDB Streams trigger the **ProvisionDevice** Lambda.
3. Lambda creates an IoT Thing + Shadow, writes a `SIMULATOR` registry item, marks the device `READY`, and sends `DEVICE_READY` to SQS.
4. The **device simulator** container on Lightsail long-polls SQS and starts an MQTT client per device.
5. Telemetry on `homehub/devices/{deviceId}/telemetry` fans out:
   - **Hot path:** IoT Rule → Lambda → DynamoDB readings + `status=ONLINE` (powers the UI).
   - **Cold path:** IoT Rule → Firehose → S3 Parquet (analytics lake; Parquet conversion requires a 64 MB buffer size — files flush on the 60s interval or when 64 MB accumulates).

Personal `sst dev` stages set `SKIP_IOT_PROVISIONING=true` so devices flip to `READY` without IoT Core — the UI remains demoable locally.

### Demo script

1. Deploy `int`: `pnpm deploy:int`
2. Register a device in the web console → detail page shows **Provisioning** then **Ready**.
3. Run the simulator on Lightsail (see `packages/device-simulator/README.md`).
4. Watch readings appear on the device detail page without manual “Record reading”.
5. After ~60s, confirm Parquet objects under `s3://{telemetryBucket}/telemetry/` and query with Athena:

```sql
SELECT deviceid, temperature, humidity, recordedat
FROM homehub_int_telemetry.device_telemetry
LIMIT 20;
```

### Simulator certs (Parameter Store)

Store pre-generated simulator certs as `SecureString` parameters (not in DynamoDB):

- `/homehub/simulator/cert`
- `/homehub/simulator/key`
- `/homehub/simulator/ca`

Attach the SST-created IoT policy (`homehub-{stage}-simulator`) to the certificate principal in the IoT console.

### Docker simulator

```bash
cd packages/device-simulator
docker build -t homehub-device-simulator:latest .
docker run -d --restart unless-stopped \
  -v /opt/homehub/certs:/certs:ro \
  -e TABLE_NAME=... \
  -e SQS_QUEUE_URL=... \
  -e AWS_REGION=eu-west-2 \
  -e IOT_ENDPOINT=https://....iot.eu-west-2.amazonaws.com \
  homehub-device-simulator:latest
```

See [`packages/device-simulator/README.md`](packages/device-simulator/README.md) for Lightsail IAM, compose-based local dev, and scaling notes.

## License

ISC
