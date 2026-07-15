# HomeHub — Smart Home IoT Hub

HomeHub is a smart-home device management platform built for a technical interview task: a **RESTful IoT API**, persistent state, error handling, infrastructure-as-code, and a **stretch frontend** for managing devices remotely.

## What this delivers

| Interview requirement | Implementation |
|---|---|
| Register a device | `POST /devices` |
| List all devices | `GET /devices` |
| Get device details | `GET /devices/{deviceId}` |
| Update device status/config | `PATCH /devices/{deviceId}` |
| Delete a device | `DELETE /devices/{deviceId}` |
| State + history storage | DynamoDB (state + recent readings); Athena for history (stretch) |
| Error handling | `400` validation errors, `404` not found, consistent JSON error shape |
| Stretch frontend | SvelteKit console (Cognito auth + REST API) |
| IaC deployment | SST v4 (Lambda + API Gateway + DynamoDB + Cognito + IoT) |

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
                         ^
                         | hot readings
              IoT Core ← MQTT ← device simulator
                         |
                         v cold path (optional)
              Firehose → S3 Parquet → Athena
```

- **REST API** — the only backend surface. Device data is scoped per user hub (`HUB#{cognitoSub}`). Reviewers can `curl` with `X-Api-Key` (demo tenant); the signed-in UI sends a Cognito ID token.
- **Cognito** — sign up / sign in for the web app. Signup creates a user profile and per-user hub.
- **DynamoDB** — single-table storage with composite `PK` / `SK` keys (no GSIs). Devices start empty until registered via `POST /devices`.
- **IoT stretch** — Step Functions provisioning, MQTT simulator, live telemetry (Dynamo hot path) and Athena history (cold path).
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
- Docker (only if you build/push the Lightsail simulator image or run the local simulator)

## Quick start

```bash
nvm use
pnpm install
uv sync --all-packages   # install Python deps for the REST API Lambda (required for sst dev)
pnpm sso          # AWS SSO login
pnpm dev          # SST hot reload on a personal stage (defaults to your OS username)
```

`pnpm dev` **never** targets `int` or `prod`. It uses a personal stage (e.g. `jarekwyprzal`) in the int AWS account so the shared CloudFront / demo stack stays intact. Override with `SST_STAGE=myname pnpm dev` if needed. Deploy the stable demo with `pnpm deploy:int`.

Register a device in the UI → Step Functions provisions cert/Thing → local simulator picks up `DEVICE_READY` → readings appear.

**Local simulator** (personal stages — Lightsail is int/prod only):

```bash
pnpm dev              # terminal 1
pnpm dev:simulator    # terminal 2 (same personal stage as pnpm dev)
```

To stub IoT (READY without cert/Thing) for faster UI-only work:

```bash
HOMEHUB_SKIP_IOT_PROVISIONING=true pnpm dev
```

Force rebuild/redeploy the Lightsail simulator image on **int**:

```bash
HOMEHUB_FORCE_SIMULATOR_DEPLOY=true pnpm simulator:deploy
```

For frontend-only local work against an already-deployed backend:

```bash
pnpm dev:local
```

## REST API

After `pnpm dev` (personal stage) or `pnpm deploy:int`, SST prints `restApiUrl`. Signed-in device endpoints use the caller's hub (`HUB#{sub}`).

Set the base URL once:

```bash
export REST_API_URL="https://your-api-id.execute-api.region.amazonaws.com"
```

When `REST_API_KEY` is unset (default for personal `sst dev`), curl works without a key. If you set a key at deploy time, add `-H "X-Api-Key: …"` to the examples below.

### Register a device

```bash
curl -s -X POST "$REST_API_URL/devices" \
  -H "Content-Type: application/json" \
  -d '{"name":"Hallway Heat","type":"heat-alarm","location":"Hallway"}'
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
  -d '{"status":"ONLINE","configuration":{"reportingIntervalSeconds":10}}'
```

### Delete a device

```bash
curl -s -X DELETE "$REST_API_URL/devices/{deviceId}"
```

### List readings (hot path)

```bash
curl -s "$REST_API_URL/devices/{deviceId}/readings"
```

### Reading history (Athena cold path)

```bash
curl -s "$REST_API_URL/devices/{deviceId}/readings/history?hours=3"
```

### User profile (web app)

```bash
# Requires Cognito ID token from a signed-in session
curl -s "$REST_API_URL/me" -H "Authorization: Bearer $ID_TOKEN"
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
3. Use **Devices** to register, view, update thresholds, toggle on/off, and delete IoT devices.
4. Open a device to see live telemetry charts and reading history.
5. On the chart, toggle **Recent** (DynamoDB) vs **Last 3h** (Athena lake query, on demand).

### Interactive API docs (on the website)

Open **`/api-docs`** on the web app (also linked from the sign-in page). It embeds Swagger UI against the live OpenAPI schema (`restApiUrl/openapi.json`) so reviewers can inspect request bodies and use **Try it out**.

Authorization is applied automatically when possible:

1. **Signed in** — uses your Cognito ID token (Bearer)
2. Else **`VITE_REST_API_KEY`** — uses `X-Api-Key`
3. Else use Swagger **Authorize** manually

## Project structure

```
apps/web/                  SvelteKit console (devices + telemetry)
packages/rest-api/         FastAPI REST API (Python, interview deliverable)
packages/core/             Shared TypeScript domain types
packages/device-simulator/ MQTT device simulator (stretch)
packages/functions/        Node.js Lambdas (Cognito post-confirmation)
infra/                     SST modules (auth, storage, REST, IoT, simulator)
scripts/                   Dev / deploy / simulator / stage reset helpers
sst.config.ts              Infrastructure entry point
```

## Assumptions

1. **REST is the only API surface** — matches the interview brief directly.
2. **Per-user hubs** — Signup creates `HUB#{userId}`; devices/readings are stored under that hub. API key access still uses `HUB#demo` for scripted testing.
3. **Device IDs are ULIDs** — server-generated, time-sortable; `createdAt` / `updatedAt` remain explicit fields.
4. **Device types** — exactly three: `heat-alarm`, `carbon-monoxide-alarm`, `humidity-sensor` (shown as an enum in OpenAPI / `/api-docs`).
5. **Configuration is a JSON object** — reporting interval + per-type thresholds (serialized to a string only inside Dynamo for IoT shadow compatibility).
6. **List endpoints return up to 50 items** — enough for the demo scale.

## Approach and challenges

**Approach**

- Reused the existing SST monorepo to show production-style IaC thinking.
- Implemented the graded REST surface in **Python + FastAPI**, deployed to Lambda with Mangum.
- Kept **Cognito + Svelte** as the stretch frontend; the UI calls REST with JWT, reviewers use curl with API key.
- Added an optional IoT stretch: async Thing/cert provisioning, MQTT simulator, and telemetry hot/cold paths.
- Shared domain types live in `@sst-monorepo/core`.

**Challenges**

- **Dual auth on one API** — JWT for the UI, API key for curl; both hit the same FastAPI routes.
- **FastAPI on Lambda** — Mangum adapts API Gateway HTTP API events to ASGI; a single `$default` route lets FastAPI own all path routing.
- **Profile vs hub** — `/me` is user-scoped; devices use `HUB#{sub}` from the JWT (or `HUB#demo` for API key).

## QA

```bash
pnpm verify    # lint, typecheck, test, build
pnpm test      # Vitest + pytest
```

Tests cover:

- FastAPI device CRUD (create, list, get, patch, delete) including 404/400 paths
- Readings list (Dynamo) and history (Athena)
- Telemetry normalization, thresholds, and IoT shadow helpers
- Athena history SQL builders and row mapping (mocked client)

## Deploy

```bash
pnpm sso
pnpm deploy:int              # stack + Lightsail simulator image
# pnpm deploy:prod
```

Useful ops scripts:

```bash
pnpm deploy:int:recover      # clean simulator IAM/SSM orphans, then redeploy
pnpm reset:int               # sst remove + orphan cleanup (int only)
pnpm remove:int              # sst remove only
pnpm simulator:deploy        # rebuild/push/redeploy Lightsail simulator
```

SST outputs:

- `restApiUrl` — REST device API
- `webUrl` — SvelteKit app
- `userPoolId` / `userPoolClientId` — Cognito
- `simulatorQueueUrl` — SQS queue for the device simulator
- `iotEndpoint` — IoT Core data endpoint (ATS)
- `deviceSimulatorServiceName` — Lightsail container service (int/prod)
- `deviceSimulatorEcrUrl` — ECR image URI for the simulator
- `telemetryBucket` — S3 bucket for Parquet telemetry
- `athenaResultsBucket` — S3 bucket for Athena query results

## IoT provision PoC (stretch)

The interview REST API and Svelte console work without Lightsail. The stretch path adds async provisioning and live MQTT telemetry.

### Flow

1. `POST /devices` writes `lifecycleStatus=PROVISIONING` to DynamoDB.
2. **EventBridge Pipe** reads the DynamoDB stream and starts the **DeviceProvision** Step Functions execution.
3. Step Functions (per device):
   - Creates an IoT **certificate** (`CreateKeysAndCertificate`)
   - Stores cert + private key in **SSM** (`/homehub/devices/{deviceId}/cert|key|ca`)
   - Attaches IoT policy, creates **Thing**, attaches cert, initializes **Shadow**
   - Writes `SIMULATOR` registry, marks device `READY`, sends `DEVICE_READY` to SQS
4. The **device simulator** on Lightsail (managed by SST) long-polls SQS, fetches per-device certs from SSM, and starts MQTT.
5. Telemetry on `homehub/devices/{deviceId}/telemetry` fans out:
   - **Hot path:** IoT Rule → Lambda → DynamoDB readings + `status=ONLINE` (powers the UI “Recent” chart).
   - **Cold path:** IoT Rule → Firehose → S3 Parquet (analytics lake; 64 MB min buffer with Parquet conversion — files flush on the 60s interval or when 64 MB accumulates).
6. Device detail **Last 3h** chart calls `GET /devices/{deviceId}/readings/history`, which runs a partition-pruned **Athena** query over the lake (on demand — not on the 10s UI poll).

Personal `sst dev` stages use the same IoT provisioning + telemetry pipeline as `int`/`prod`, but **without** Lightsail — run `pnpm dev:simulator` locally instead. Set `HOMEHUB_SKIP_IOT_PROVISIONING=true` only when you want to stub provisioning for UI-only work.

**Athena caveats:** Firehose buffering means the lake is ~1 minute behind live MQTT; the first query after deploy can be slower; empty charts are normal until Parquet objects land. Cost stays tiny at demo scale (Athena bills by data scanned, ~$5/TB with a 10 MB minimum per query) as long as history is fetched on demand.

### Demo script

**Shared int demo (Lightsail + CloudFront):**

1. Deploy `int`: `pnpm deploy:int` (never `pnpm dev` against int)
2. Register a device in the web console → detail page shows **Provisioning** then **Ready**.
3. Simulator runs on Lightsail (`pnpm simulator:deploy` if you need a rebuild).
4. Watch readings appear on the device detail page without manual “Record reading”.
5. After ~60s, confirm Parquet objects under `s3://{telemetryBucket}/telemetry/hub={yourUserId}/` and use **Last 3h** on the device chart, or query with Athena:

```sql
SELECT deviceid, metrics, recordedat
FROM homehub_int_telemetry.device_telemetry
WHERE hub = 'your-cognito-sub' AND year = '2026' AND month = '07' AND day = '15'
LIMIT 20;
```

**Personal hot-reload loop:**

1. `pnpm dev` (personal stage) + `pnpm dev:simulator` in a second terminal
2. Register a device → provisioning → local Docker simulator MQTT → live readings

### Per-device certs (SSM)

Provisioning creates real IoT certificates automatically. Private keys are stored as SSM `SecureString` parameters:

- `/homehub/devices/{deviceId}/cert`
- `/homehub/devices/{deviceId}/key`
- `/homehub/devices/{deviceId}/ca`

Never stored in DynamoDB or SQS. On device delete, the REST API revokes the cert and deletes SSM parameters.

### Docker simulator

SST provisions Lightsail Container Service + ECR. To redeploy the container image:

```bash
pnpm simulator:deploy
```

Local fallback:

```bash
pnpm dev:simulator
```

See [`packages/device-simulator/README.md`](packages/device-simulator/README.md) for scaling notes.

## License

ISC
