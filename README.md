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
| Stretch frontend | SvelteKit devices UI with readings, commands, and issues |
| IaC deployment | SST v4 (AWS Lambda + API Gateway + DynamoDB + Cognito + AppSync) |

## Architecture

```
Reviewers / curl          HomeHub web app (SvelteKit)
       |                            |
       v                            v
 REST API (API Gateway)      GraphQL API (AppSync)
       \                            /
        \                          /
         v                        v
              DynamoDB (single table)
```

- **REST API** — interview-facing surface on a demo tenant (`HUB#demo`). Reviewers can `curl` endpoints without Cognito.
- **GraphQL API** — authenticated app API for the Svelte console (per-user devices, readings, commands, issues).
- **DynamoDB** — shared storage using composite `PK` / `SK` keys.
- **SST v4** — infrastructure defined in [`sst.config.ts`](sst.config.ts) and [`infra/`](infra/).

## Tech stack

- **Frontend**: SvelteKit 2, TypeScript, Tailwind CSS
- **REST API**: FastAPI on AWS Lambda (Python 3.13) via API Gateway HTTP API
- **App API**: AWS AppSync GraphQL + Cognito auth
- **Database**: DynamoDB
- **Monorepo**: pnpm workspaces + Turborepo
- **Validation / tests**: Pydantic + pytest (REST), Zod + Vitest (shared TS packages)

## Prerequisites

- Node.js 24
- pnpm
- Python 3.13 + [uv](https://docs.astral.sh/uv/) (for the FastAPI REST API)
- AWS CLI with SSO (for deploy / `sst dev`)

## Quick start

```bash
nvm use
pnpm install
pnpm sso          # AWS SSO login
pnpm dev          # SST dev mode (deploys stack + runs web app)
```

For frontend-only local work against an already-deployed backend:

```bash
pnpm dev:local
```

Run the REST API locally without AWS (in-memory store):

```bash
pnpm api:local
# Open http://127.0.0.1:8000/docs for interactive OpenAPI docs
```

## REST API

After `pnpm dev` or `pnpm deploy:int`, SST prints `restApiUrl`. All device endpoints use the demo tenant.

### Register a device

```bash
curl -s -X POST "$REST_API_URL/devices" \
  -H "Content-Type: application/json" \
  -d '{"name":"Living Room Camera","type":"security-camera","location":"Living Room","configuration":"{\"motionDetection\":true}"}'
```

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

### Optional API key

Set `REST_API_KEY` before deploy to require `X-Api-Key` on REST requests:

```bash
REST_API_KEY=your-review-key pnpm deploy:int
```

```bash
curl -s "$REST_API_URL/devices" -H "X-Api-Key: your-review-key"
```

## Web app (stretch frontend)

1. Open the deployed web URL (or local dev URL from SST).
2. Sign up / sign in with Cognito.
3. Use **Devices** to register, view, update, and delete IoT devices.
4. Open a device to record readings, send commands, and see linked issues.
5. Use **Issues** to track home problems raised from sensor data.

## Project structure

```
apps/web/                  SvelteKit console (devices, issues, account)
packages/rest-api/         FastAPI REST API (Python, interview deliverable)
packages/core/             Shared TypeScript validation helpers
packages/functions/        Node.js Lambdas (Cognito post-confirmation)
packages/graphql/          GraphQL schema + generated types
infra/                     SST modules (auth, storage, AppSync, REST API)
sst.config.ts              Infrastructure entry point
```

## Assumptions

1. **REST is the graded API surface** — GraphQL powers the authenticated web app but REST maps directly to the interview brief.
2. **Demo tenant for REST** — Reviewer data lives under `HUB#demo`, separate from per-user Cognito data (`USER#...`).
3. **Device types are free-form strings** — e.g. `security-camera`, `thermostat`, `smart-light`, `sensor`.
4. **Configuration is JSON stored as a string** — flexible for lights, thermostats, cameras, etc.
5. **Commands are queued as `PENDING`** — no real device firmware integration in this task.
6. **Home issues are a stretch feature** — simplified case tracking, not full housing compliance software.

## Approach and challenges

**Approach**

- Reused the existing SST monorepo instead of a throwaway repo, to show production-style IaC thinking.
- Implemented the graded REST surface in **Python + FastAPI**, deployed to Lambda with Mangum — matching the interview brief's backend-first focus.
- Kept GraphQL + Svelte for the authenticated stretch frontend.
- Used Pydantic validation and pytest for the REST API; TypeScript packages still use Zod/Vitest where relevant.

**Challenges**

- **Two API surfaces, one table** — REST uses a demo tenant while GraphQL scopes data per Cognito user. Clear key prefixes keep them isolated.
- **FastAPI on Lambda** — Mangum adapts API Gateway HTTP API events to ASGI; a single `$default` route lets FastAPI own all path routing.
- **IoT “real-time” scope** — True streaming would need MQTT/WebSockets; readings + commands provide monitor/control history within the task scope.

## QA

```bash
pnpm verify    # codegen, lint, typecheck, test, build
pnpm test      # Vitest only
```

Tests cover:

- FastAPI route behaviour (create, list, 404, 400, readings, commands) via pytest
- TypeScript validation helpers and humidity threshold logic via Vitest

## Deploy (optional)

```bash
pnpm sso
pnpm deploy:int
```

SST outputs:

- `restApiUrl` — REST device API
- `apiUrl` — AppSync GraphQL endpoint
- `webUrl` — SvelteKit app

## License

ISC
