# HomeHub

A smart-home app for managing IoT devices. Built for a technical interview: REST API, database, error handling, cloud deploy, and a web UI.

## Short version

- **What** — FastAPI REST API on AWS Lambda, DynamoDB, Cognito login, Svelte web UI. IoT stretch: **real AWS IoT Core** (certs, things, MQTT rules) with a **virtual device simulator** (not physical hardware).
- **Run locally** — `pnpm install`, `uv sync --all-packages`, `pnpm sso`, `pnpm dev` (personal AWS stage, not `int`/`prod`).
- **Try the API** — Open the web app → **`/api-docs`** (Swagger). Use **Try it out** on any endpoint.
- **Try the UI** — Sign in → **Devices** → add a device → open it for charts.
- **IoT flow** — Add device (`PROVISIONING`) → DynamoDB stream triggers Step Functions → real AWS IoT cert + thing + shadow → simulator publishes MQTT → live readings in DynamoDB → older data in S3/Athena (**Last 3h** chart).
- **Simulator** — Personal `pnpm dev`: run `pnpm dev:simulator` locally (Docker). Shared `int`/`prod`: Lightsail container (not on personal stages).

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
| Older readings (stretch) | `GET /devices/{deviceId}/readings/history` |
| Health check | `GET /health` |
| Ready check (DB) | `GET /ready` |

- **Storage** — DynamoDB for devices and recent readings; Athena for older history (stretch)
- **Errors** — Same JSON shape everywhere: `{"error": "...", "code": "..."}`
- **Web app** — SvelteKit UI with Cognito login (stretch)
- **Deploy** — SST v4 on AWS (Lambda, API Gateway, DynamoDB, Cognito, IoT)

## How it fits together

```
API docs / reviewers        Web app (browser)
      |                         |
      | API key                 | Login token
      v                         v
         REST API (API Gateway)
                  |
                  v
            DynamoDB
                  ^
                  | live readings
         IoT Core ← MQTT ← device simulator
                  |
                  v
         S3 + Athena (history, stretch)
```

- **REST API** — All backend calls go here. Each user gets their own hub. Reviewers use the API docs (or an API key); the web app uses a login token.
- **Cognito** — Sign up and sign in for the web app.
- **DynamoDB** — One table stores users, devices, and readings.
- **IoT (stretch)** — Real AWS IoT Core provisioning; a software simulator acts as the hardware. Live and historical charts need the simulator running (local Docker or Lightsail).
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
- Docker (only for the local device simulator)

## Get started

```bash
nvm use
pnpm install
uv sync --all-packages
pnpm sso
pnpm dev
```

`pnpm dev` uses your own AWS stage (your username). It does **not** touch the shared `int` or `prod` stacks.

Add a device in the UI → cloud provisions the IoT thing → **run the simulator** (see below) → readings show on the device page.

**Run the simulator** — Readings only appear when the simulator is running. On personal stages, use local Docker:

```bash
pnpm dev              # terminal 1
pnpm dev:simulator    # terminal 2 (required for live MQTT readings)
```

On `int`/`prod`, the simulator runs on Lightsail automatically after deploy.

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
| Reviewers / API docs | API key (when `REST_API_KEY` is set at deploy) or Cognito token |
| Web app | Cognito login token on each request |

Set an API key before deploy if you want key-only access for reviewers:

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
5. Toggle **Recent** (database) vs **Last 3h** (Athena, stretch).
6. Open **API docs** (`/api-docs`) to explore or test the REST API.

## Project layout

```
apps/web/                  Web UI
packages/rest-api/         FastAPI (main interview deliverable)
packages/core/             Shared TypeScript types
packages/device-simulator/ MQTT simulator (stretch)
packages/functions/        Cognito signup Lambda
infra/                     AWS resources (SST modules)
scripts/                   Deploy and dev helpers
sst.config.ts              Infra entry point
```

## Design choices

1. **REST only** — Matches the interview brief.
2. **One hub per user** — Signup creates `HUB#{userId}`. API key access uses `HUB#demo` for testing.
3. **Device IDs** — Server creates ULIDs (sortable, unique).
4. **Three device types** — `heat-alarm`, `carbon-monoxide-alarm`, `humidity-sensor`.
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
pnpm deploy:int:recover      # fix stuck simulator, redeploy
pnpm reset:int               # tear down int stack
pnpm simulator:deploy        # rebuild Lightsail simulator (int/prod)
```

SST prints URLs and IDs when deploy finishes: API URL, web URL, Cognito pool, IoT endpoint, S3 buckets, etc.

## IoT stretch

IoT resources (IoT Core, Step Functions, telemetry rules, S3, Athena) deploy on **every stage**. The interview “stretch” is the full live pipeline — not whether the infra exists.

- **CRUD always works** — REST API and web UI manage devices without a running simulator.
- **Live readings need the simulator** — local Docker on personal `pnpm dev`, or Lightsail on `int`/`prod`.

**Flow** (see **Short version**): DynamoDB stream → EventBridge Pipe → Step Functions → SQS `DEVICE_READY` → simulator MQTT → IoT rules → DynamoDB (hot) / S3 (cold).

**Demo on `int`:**

1. `pnpm deploy:int`
2. Add a device in the web UI.
3. Wait for **Ready** (Lightsail simulator picks it up automatically).
4. Watch readings on the device page; after ~60s try **Last 3h** (Firehose buffer before Parquet lands in S3).

**Certs** — Real per-device X.509 certs in SSM (`/homehub/devices/{deviceId}/cert|key|ca`), not in DynamoDB. Revoked and deleted when you remove a device.

## License

ISC
