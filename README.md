# HomeHub

A smart-home app for managing IoT devices — **serverless, event-driven architecture** on AWS with a **single-table DynamoDB** design. REST API, Cognito auth, Svelte web UI, and SST infrastructure.

**Repo & deploy:** **pnpm** monorepo with **Turborepo**. **GitHub Actions** deploys via PR labels `deploy:int` and `deploy:prod` across **two AWS Organization accounts** (int and prod).

**Live**

| | URL |
|---|---|
| **int** | https://homehub-int.apps.jarekwyprzal.com |
| **int API docs** | https://homehub-int.apps.jarekwyprzal.com/api-docs |
| **prod** | https://homehub.apps.jarekwyprzal.com |
| **prod API docs** | https://homehub.apps.jarekwyprzal.com/api-docs |

**IoT pipeline:** DynamoDB stream → EventBridge Pipe → Step Functions → SQS `DEVICE_READY` → simulator MQTT → IoT rules → DynamoDB (hot) · Firehose → S3 (Parquet) → Athena (history).

## Short version

- **What** — FastAPI REST API on AWS Lambda, DynamoDB, Cognito login, Svelte web UI. **AWS IoT Core** (certs, things, MQTT rules) with a Docker MQTT runtime (local or Raspberry Pi).
- **Run locally** — `pnpm install`, `uv sync --all-packages`, `pnpm sso`, `pnpm dev` (personal AWS stage, not `int`/`prod`).
- **Try the API** — Open the web app → **`/api-docs`** (Swagger). Use **Try it out** on any endpoint.
- **Try the UI** — Sign in → **Devices** → add a device → open it for charts or camera snapshots.
- **IoT flow** — Add device (`PROVISIONING`) kicks off the pipeline above (IoT cert + thing + shadow). **Last 3h** history is queried from Athena over S3 Parquet.
- **Device runtime** — Personal `pnpm dev`: `pnpm dev:simulator` (local Docker). Shared stages and cameras: `pnpm device:deploy` to the Pi. No Lightsail.

Details below.

## What it does

| Task | API |
|------|-----|
| Add a device | `POST /devices` |
| List devices | `GET /devices` |
| Get one device | `GET /devices/{deviceId}` |
| Update a device | `PATCH /devices/{deviceId}` |
| Delete a device | `DELETE /devices/{deviceId}` |
| Recent readings | `GET /devices/{deviceId}/readings` |
| Older readings | `GET /devices/{deviceId}/readings/history` |
| Camera snapshot | `GET /devices/{deviceId}/snapshot` |
| Health check | `GET /health` |
| Ready check (DB) | `GET /ready` |

- **Storage** — DynamoDB for devices and recent readings; Athena for older history
- **Errors** — Same JSON shape everywhere: `{"error": "...", "code": "..."}`
- **Web app** — SvelteKit UI with Cognito login
- **Deploy** — SST v4 on AWS (Lambda, API Gateway, DynamoDB, Cognito, IoT)

## How it fits together

```
API docs / integrations      Web app (browser)
      |                         |
      | API key                 | Login token
      v                         v
         REST API (API Gateway)
                  |
                  v
            DynamoDB
                  ^
                  | live readings
         IoT Core ← MQTT ← device runtime (Docker / Pi)
                  |
                  v
         S3 Parquet + Athena (history)
```

- **REST API** — All backend calls go here. Each user gets their own hub. API clients use the API docs (or an API key); the web app uses a login token.
- **Cognito** — Sign up and sign in for the web app.
- **DynamoDB** — One table stores users, devices, and readings.
- **IoT** — AWS IoT Core provisioning. Sensors can run as a software simulator; cameras run on a Raspberry Pi 5. Live readings need the Docker runtime (`pnpm dev:simulator` or `pnpm device:deploy`).
- **SST** — All AWS resources live in [`sst.config.ts`](sst.config.ts) and [`infra/`](infra/).

## Tech stack

- **Web** — SvelteKit, TypeScript, Tailwind, Cognito (Amplify)
- **API** — FastAPI on Lambda (Python 3.13)
- **Database** — DynamoDB
- **Repo** — pnpm monorepo + Turborepo
- **Tests** — pytest (API), Vitest (shared types)

## What you need

- Node.js 24
- pnpm
- Python 3.13 + [uv](https://docs.astral.sh/uv/)
- AWS CLI with SSO (for deploy)
- Docker (local simulator and/or Pi camera runtime)

## Get started

```bash
nvm use
pnpm install
uv sync --all-packages
pnpm sso
pnpm dev
```

`pnpm dev` uses your own AWS stage (your username). It does **not** touch the shared `int` or `prod` stacks.

Add a device in the UI → cloud provisions the IoT thing → **run the device runtime** (see below) → readings or snapshots show on the device page.

**Run the runtime** — Live MQTT data only appears when the Docker client is running.

```bash
pnpm dev              # terminal 1
pnpm dev:simulator    # terminal 2 — local sensors (Mac)
# or
pnpm device:deploy    # Raspberry Pi 5 (sensors + Camera Module 3)
```

Work on the frontend against an already-deployed backend:

```bash
pnpm dev:local
```

Deploy the shared demo: `pnpm deploy:int`

## REST API

After `pnpm dev` or `pnpm deploy:int`, SST prints `restApiUrl`. The API also exposes OpenAPI at `{restApiUrl}/openapi.json`.

**Try the API in the browser** — open **`/api-docs`** on the web app (linked from the sign-in page). Swagger UI loads the live schema so you can see every endpoint, request body, and response. Use **Try it out** to send real requests.

Auth in Swagger is filled in when it can:

1. **Signed in** — uses your Cognito token (Bearer)
2. **Else** — uses `VITE_REST_API_KEY` if set (API key header)
3. **Else** — click **Authorize** and add a Bearer token or API key manually

| Who | How to auth |
|-----|-------------|
| API docs / integrations | API key (when `REST_API_KEY` is set at deploy) or Cognito token |
| Web app | Cognito login token on each request |

Set an API key before deploy if you want key-only access for API clients:

```bash
REST_API_KEY=your-key pnpm deploy:int
```

On personal `pnpm dev` stages the key is usually unset, so the API works without auth for local testing.

**Pagination** — `GET /devices` accepts `limit` (default 50, max 100) and `cursor`. Responses include `nextCursor` when there are more pages.

## Web app

1. Open the URL from SST (or local dev).
2. Sign up or sign in.
3. Go to **Devices** — add, edit, turn on/off, delete devices.
4. Open a device — see live charts and history.
5. Toggle **Recent** (database) vs **Last 3h** (Athena).
6. Open **API docs** (`/api-docs`) to explore or test the REST API.

## Project layout

```
apps/web/                  Web UI
packages/rest-api/         FastAPI REST API
packages/core/             Shared TypeScript types
packages/device-simulator/ MQTT device simulator
packages/functions/        Cognito signup Lambda
infra/                     AWS resources (SST modules)
scripts/                   Deploy and dev helpers
sst.config.ts              Infra entry point
```

## Design choices

1. **REST API** — Standard HTTP endpoints for device management and readings.
2. **One hub per user** — Signup creates `HUB#{userId}`. API key access uses `HUB#demo` for testing.
3. **Device IDs** — Server creates ULIDs (sortable, unique).
4. **Four device types** — `heat-alarm`, `carbon-monoxide-alarm`, `humidity-sensor`, `camera`.
5. **Config is JSON** — Thresholds and reporting interval per device.
6. **Lists are paginated** — Default 50 per page, max 100. Use `cursor` for the next page.

## Tests

```bash
pnpm verify    # lint, typecheck, test, build
pnpm test      # Vitest + pytest
```

Tests cover device CRUD, pagination, auth errors, health checks, readings, telemetry, and Athena helpers.

## Deploy

```bash
pnpm sso
pnpm deploy:int
```

Other useful commands:

```bash
pnpm deploy:int:recover      # clean leftover Lightsail/ECR, redeploy SST
pnpm reset:int               # tear down int stack
pnpm device:deploy           # SSH the MQTT runtime to the Pi
```

SST prints URLs and IDs when deploy finishes: API URL, web URL, Cognito pool, IoT endpoint, S3 buckets, etc.

## IoT & telemetry

IoT resources (IoT Core, Step Functions, telemetry rules, S3, Athena) deploy on **every stage**.

- **CRUD always works** — REST API and web UI manage devices without a running runtime.
- **Live readings need the Docker MQTT client** — `pnpm dev:simulator` locally, or `pnpm device:deploy` on the Pi.

**Demo on `int`:**

1. `pnpm deploy:int`
2. `pnpm device:deploy` (with `SST_STAGE=int`) if you want live MQTT / camera.
3. Add a device in the web UI.
4. Wait for **Ready** (the Pi or local Docker client picks it up from SQS).
5. Watch readings or snapshots on the device page; after ~60s try **Last 3h** (Firehose buffer before Parquet lands in S3).

**Certs** — Real per-device X.509 certs in SSM (`/homehub/devices/{deviceId}/cert|key|ca`), not in DynamoDB. Revoked and deleted when you remove a device.

## License

ISC
