# Contributing

## Setup

```bash
nvm use
pnpm install
uv sync --all-packages
cp .env.example .env.local
```

Fill in `.env.local` for your own AWS account.

### AWS profiles

`pnpm sso` runs `aws sso login --sso-session=homehub`. Local deploys use the `homehub-int` profile for `int` and for personal `sst dev` stages, and `homehub-prod` for `prod`. A sample `~/.aws/config`:

```ini
[sso-session homehub]
sso_start_url = https://your-org.awsapps.com/start
sso_region = eu-west-1
sso_registration_scopes = sso:account:access

[profile homehub-int]
sso_session = homehub
sso_account_id = 123456789012
sso_role_name = YourRole
region = eu-west-1

[profile homehub-prod]
sso_session = homehub
sso_account_id = 210987654321
sso_role_name = YourRole
region = eu-west-1
```

Those names are defaults. Override them with `AWS_PROFILE_INT` and `AWS_PROFILE_PROD` (see `.env.example`) instead of editing the scripts. Without `APP_URL`, a deploy uses the CloudFront hostname SST assigns.

Custom DNS is optional. `APPS_HOSTED_ZONE_ID` is the Route 53 zone for `APP_DOMAIN`. When that zone lives in another account, set `DNS_ROLE_ARN` to a role that can change its records, and `DNS_SOURCE_PROFILE` (default `admin`) to the local profile used to assume it.

Stage resources are named from the stage: the DynamoDB table contains `homehub-<stage>` and `AppTable`, camera snapshots use `homehub-snapshots-<stage>`, and the camera IoT role alias is `homehub-<stage>-camera-s3`.

## Checks

```bash
pnpm verify
```

That runs Biome, TypeScript, Vitest, pytest, and the production build. Python checks, the same ones as `pnpm lint:api`, are `uv run --directory services/api ruff check .`, `uv run --directory services/api ruff format --check .`, and `uv run --directory services/api mypy`.

Firmware is an overlay for ESP-IDF and Arduino. It is not part of `pnpm verify`. See `firmware/cores3-gateway/README.md` and `docs/timer-camera-f-setup.md`.

## Layout

- `apps/web` — SvelteKit console
- `services/api` — FastAPI on Lambda
- `services/auth-triggers` — Cognito post-confirmation Lambda
- `packages/core` — shared TypeScript domain types
- `packages/catalog` — JSON shared by TypeScript and Python
- `firmware/` — device firmware
- `infra/` — SST modules
- `scripts/` — deploy, flash, and provisioning helpers

## Pull requests

Open a pull request against `main`. CI must pass. Describe what changed and how you tested it.
