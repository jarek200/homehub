# SST Monorepo Starter

> Template Repository — click "Use this template" to create a new project from this starter

A modern, production-ready platform template for building full-stack serverless applications on AWS with multi-environment support.

- **Frontend**: SvelteKit 2 + TypeScript + Tailwind CSS
- **Backend**: AWS AppSync (GraphQL) with JavaScript resolvers
- **Database**: DynamoDB (single-table design)
- **Authentication**: AWS Cognito User Pools
- **Infrastructure**: SST v4 with Pulumi
- **Monorepo**: pnpm workspaces + Turborepo (task caching)
- **Agents (optional)**: `packages/agent-core` — Python + Strands + **Bedrock AgentCore** starter toolkit (`pnpm agent:python`, then `agentcore` CLI — see `packages/agent-core/README.md`) + Cursor rule **Python AgentCore**

## Architecture overview

```
pnpm workspace (root)
├── apps/web          SvelteKit web app — landing, login, dashboard (SST SvelteKit component)
├── packages/         Shared code (core, graphql, functions, agent-core)
├── infra/            SST infrastructure modules (AppSync, Cognito, DynamoDB)
├── platform/webiny   Optional Webiny CMS — Yarn toolchain; not part of pnpm (see platform/webiny/README.md)
└── sst.config.ts     SST v4 config — stage-aware, multi-account
```

## Environments

Three first-class stages, each targeting an isolated AWS account:

| Stage   | Purpose                     | AWS account  | Removal policy |
|---------|-----------------------------|--------------|----------------|
| `dev`   | Daily development work      | dev account  | `remove`       |
| `stage` | Pre-production validation   | stage account| `remove`       |
| `prod`  | Live production             | prod account | `retain`       |

Any other stage name (e.g. `jarek`, `feature-x`) falls back to the `dev` AWS profile and
uses the `remove` policy — safe for short-lived personal stacks.

## Prerequisites

- **Node.js 24** (`nvm install 24`)
- **pnpm** (`npm install -g pnpm`)
- **AWS CLI** and SSO configured (see [Local AWS setup](#local-aws-setup))

## Quick Start

### 1. Install dependencies

```bash
nvm use
pnpm install
```

### 2. Local AWS setup

Follow [SST's AWS accounts guide](https://sst.dev/docs/aws-accounts) to set up AWS Organizations
with SSO. Then configure `~/.aws/config`:

```ini
[sso-session acme]
sso_start_url  = https://acme.awsapps.com/start
sso_region     = us-east-1

[profile acme-dev]
sso_session    = acme
sso_account_id = 111111111111
sso_role_name  = AdministratorAccess
region         = us-east-1

[profile acme-stage]
sso_session    = acme
sso_account_id = 222222222222
sso_role_name  = AdministratorAccess
region         = us-east-1

[profile acme-prod]
sso_session    = acme
sso_account_id = 333333333333
sso_role_name  = AdministratorAccess
region         = us-east-1
```

Log in:

```bash
pnpm sso
# Or: aws sso login --sso-session=acme
```

Rename the profile keys in `sst.config.ts` (`STAGE_PROFILES` map at the top) to match your
actual profile names.

### 3. Start development

```bash
pnpm dev   # SST dev multiplexer: deploys infra + starts SvelteKit with hot reload
```

`pnpm dev` automatically injects environment variables — no `.env` file needed.

### 4. Deploy per environment

```bash
pnpm deploy:dev    # deploy to dev account
pnpm deploy:stage  # deploy to stage account
pnpm deploy:prod   # deploy to prod account
```

Or with the SST CLI directly:

```bash
pnpm exec sst deploy --stage dev
pnpm exec sst deploy --stage stage
pnpm exec sst deploy --stage prod
```

## New project checklist

After creating a repository from this template, do these before shipping:

- Rename project metadata in root and app `package.json` files.
- Update AWS account IDs, profile names, and role ARNs in `sst.config.ts` and GitHub Environments.
- If you use delegated app domains, set `APP_URL`, `APPS_HOSTED_ZONE_ID`, and `DNS_ROLE_ARN` in each GitHub Environment.
- Create the required PR labels (`deploy:dev`, `deploy:stage`, `deploy:prod`).
- Enable **branch protection rules** on `main` (see [Branch protection](#branch-protection) below).
- Review defaults in `infra/` (domain names, auth settings, table names, retention policy).
- Run `pnpm verify` and make sure CI passes before first deployment.

## Project structure

```
sst-monorepo/
├── apps/
│   └── web/                      SvelteKit UI
│       ├── src/
│       │   ├── lib/
│       │   │   ├── components/ui/  UI components
│       │   │   ├── services/       GraphQL service
│       │   │   └── stores/         Auth store
│       │   └── routes/
│       │       ├── +page.svelte    Landing
│       │       ├── login/          Sign in / sign up
│       │       └── (protected)/dashboard/  Post-login dashboard
│       └── package.json
├── packages/
│   ├── core/                     Shared types and utilities
│   ├── functions/                Lambda functions
│   │   └── auth/                 User profile creation trigger
│   └── graphql/                  GraphQL schema + codegen output
├── infra/                        SST infrastructure modules
│   ├── storage.ts                DynamoDB table
│   ├── functions.ts              Lambda function definitions
│   ├── auth.ts                   Cognito User Pool
│   └── api/
│       ├── api-setup.ts          AppSync API and data sources
│       └── resolvers/            GraphQL resolvers (JS, AppSync-native)
│           ├── index.ts
│           └── users.ts
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                Quality gate (lint, typecheck, test, build)
│   │   └── deploy.yml            Label-driven deploy pipeline
│   └── dependabot.yml            Automated dependency updates
├── sst.config.ts                 SST v4 config (stages, accounts, resources)
├── turbo.json                    Turborepo task pipeline (build, typecheck, test, codegen)
├── LICENSE
└── package.json
```

## SST v4 migration notes

This project uses **SST v4** (upgraded from v3/Ion).

Key changes from v3:
- Pulumi AWS provider bumped from v6 to v7 (already reflected in `package.json`)
- No breaking changes to SST components used here (Dynamo, CognitoUserPool, AppSync, Function, SvelteKit)
- `svelte-kit-sst` stays at `"2"` (the v3 package is experimental and built against SvelteKit v1)

If you have existing stacks deployed under SST v3, migrate them before deploying with v4:

```bash
# 1. Review what will change
pnpm exec sst diff --stage dev

# 2. Migrate state (run once per stage, do NOT use --target)
pnpm exec sst refresh --stage dev
pnpm exec sst refresh --stage stage
# For stages that only ever ran under sst dev:
pnpm exec sst refresh --stage dev --dev

# 3. Deploy as normal
pnpm deploy:dev
```

## GitHub Actions and label-driven deployment

CI runs automatically on every PR and push to `main`/`develop`. Jobs: **lint**, **typecheck** (with codegen drift check), **test**, and **build** — build only runs when lint and tests pass.

Deployment is triggered by **adding labels to an open PR**:

```
Open PR
  └─ add label "deploy:dev"   → deploys SST to dev account
       └─ passes → add label "deploy:stage" → deploys to stage account
            └─ passes → add label "deploy:prod"  → deploys to prod account
                 └─ passes → merge PR
```

The `deploy:stage` job checks that `deploy:dev` is present on the PR before running.
The `deploy:prod` job checks that both `deploy:dev` and `deploy:stage` are present.
The `prod` GitHub Environment additionally requires a human reviewer to approve.

### One-time GitHub setup

1. Create three GitHub Environments: `dev`, `stage`, `prod`
   - On `prod`: enable **Required reviewers**
2. Add `AWS_ROLE_ARN` secret to each Environment:
   - `dev` → `arn:aws:iam::111111111111:role/GHActions-Dev`
   - `stage` → `arn:aws:iam::222222222222:role/GHActions-Stage`
   - `prod` → `arn:aws:iam::333333333333:role/GHActions-Prod`
3. If you want automated custom domains, also add:
   - Variable `APP_URL`
     - `dev` → deployed app URL for that environment
     - `stage` → deployed app URL for that environment
     - `prod` → deployed app URL for that environment
   - Variable `APPS_HOSTED_ZONE_ID`
     - delegated Route 53 hosted zone ID for your apps domain
   - Secret `DNS_ROLE_ARN`
     - cross-account role ARN that can manage DNS in that hosted zone
4. Create IAM OIDC provider in each AWS account and a role with this trust condition:
   ```json
   "token.actions.githubusercontent.com:sub":
     "repo:<org>/<repo>:environment:<env-name>"
   ```

No long-lived AWS credentials are stored in GitHub secrets.

### Create the PR labels

In your GitHub repo, create these labels (Settings → Labels):

| Label           | Colour suggestion | Purpose                   |
|-----------------|-------------------|---------------------------|
| `deploy:dev`    | `#0075ca`         | Trigger dev deployment    |
| `deploy:stage`  | `#e4e669`         | Trigger stage deployment  |
| `deploy:prod`   | `#d93f0b`         | Trigger prod deployment   |

### Branch protection

Enable branch protection on `main` (Settings → Branches → Add rule):

| Setting                                | Recommended value |
|----------------------------------------|-------------------|
| Require a pull request before merging  | Yes               |
| Required approvals                     | 1+                |
| Require status checks to pass          | `Lint & Type Check`, `Test`, `Build` |
| Require branches to be up to date      | Yes               |
| Restrict who can push                  | Admins only       |
| Do not allow bypassing the above       | Yes (for teams)   |

This prevents direct pushes to `main` and ensures every change goes through CI and code review.

## GraphQL code generation

After updating `packages/graphql/schema.graphql`:

```bash
pnpm codegen         # one-time
pnpm codegen:watch   # watch mode during development
```

Generated types are imported as:

```typescript
import type { User, UpdateUserInput } from '@sst-monorepo/graphql';
```

## Environment variables

`pnpm dev` (SST dev mode) injects all variables automatically — no `.env` needed.

For local-only frontend development (`pnpm dev:local`), set `VITE_*` variables the same way as in
`sst.config.ts`’s `sharedEnv` (or use `pnpm dev` so SST injects them).

## Database schema (DynamoDB — single-table design)

**Primary key**: `PK` (partition) + `SK` (sort)

**GSI1**: `GSI1PK` + `GSI1SK` — user-centric queries  
**GSI2**: `GSI2PK` + `GSI2SK` — global queries

Entity patterns:
- `USER#${userId}` / `PROFILE` — user profiles

## Adding new features

### New GraphQL type

1. Update `packages/graphql/schema.graphql`
2. Run `pnpm codegen`
3. Add resolver in `infra/api/resolvers/`
4. Add service method in `apps/web/src/lib/services/graphql.ts`

### New Lambda function

1. Create handler in `packages/functions/src/`
2. Define function in `infra/functions.ts`
3. Link it via `link:` in `sst.config.ts`

## Cost estimate

For a new app with fewer than 1,000 users:

| Service    | Free tier                               | Estimated cost |
|------------|-----------------------------------------|----------------|
| DynamoDB   | 25 GB storage, 25 R/W units             | $0–5/month     |
| AppSync    | 250K query/mutation operations          | $0–10/month    |
| Cognito    | 50K MAU                                 | $0             |
| Lambda     | 1M requests, 400K GB-seconds            | $0             |
| CloudFront | 1 TB data transfer                      | $0–5/month     |
| **Total**  |                                         | **$0–20/month**|

## License

[ISC](LICENSE)
