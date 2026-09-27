# Contributing

## Setup

```bash
nvm use
pnpm install
uv sync --all-packages
cp .env.example .env.local
```

Fill in `.env.local` for your own AWS account. `pnpm sso` logs in when you use the sample AWS profiles.

## Checks

```bash
pnpm verify
```

That runs Biome, TypeScript, Vitest, pytest, and the production build. Python lint is `uv run ruff check services/api` and `uv run ruff format --check services/api`.

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
