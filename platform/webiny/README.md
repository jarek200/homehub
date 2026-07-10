# Webiny CMS Platform

Webiny is a self-hosted, serverless CMS deployed to your own AWS account. This folder is
**intentionally outside** the root pnpm workspace so Webiny's Yarn toolchain does not conflict
with the rest of the monorepo.

## How Webiny works

Webiny is **not a package you import** and not a repo you clone. It is scaffolded locally with
`npx create-webiny-project`, which generates a self-contained project with:

- `webiny.config.tsx` — the single config file (infrastructure settings + extensions)
- `extensions/` — where all your custom code lives (content models, resolvers, hooks)

Webiny then deploys three AWS application groups from that project:
1. **Core** — shared infrastructure (DynamoDB, S3, Cognito, EventBridge)
2. **API** — GraphQL HTTP API (Lambda + CloudFront)
3. **Admin** — React-based admin UI (S3 + CloudFront)

Everything runs serverless on AWS. You own all the infrastructure.

## Prerequisites

- **Node.js ≥24** (`nvm install 24`)
- **Yarn** (`npm install -g yarn`) — Webiny uses Yarn, not pnpm
- **AWS account and credentials** configured for the target environment

## One-time scaffolding

Run this **inside `platform/webiny/`** to create the project:

```bash
cd platform/webiny
npx create-webiny-project .
```

The CLI will prompt you for:
- **AWS region** to deploy to
- **Database**: choose **DynamoDB** for getting started (free tier, no minimum cost)
  - DynamoDB + OpenSearch is for large enterprise projects (~$25/month minimum — avoid unless needed)

After scaffolding you will have:
```
platform/webiny/
├── webiny.config.tsx     # infrastructure + extension registration
├── extensions/           # your custom content models, hooks, resolvers
├── package.json
└── yarn.lock             # commit this
```

Commit `yarn.lock`. Do **not** commit `.webiny/` or `node_modules/`.

## Environments

Webiny uses `--env` to separate environments, matching SST stage names:

| SST stage | Webiny env flag | AWS account   |
|-----------|-----------------|---------------|
| `dev`     | `--env dev`     | dev account   |
| `stage`   | `--env stage`   | stage account |
| `prod`    | `--env prod`    | prod account  |

The default environment when no flag is given is `dev`.

## First deployment

```bash
cd platform/webiny
yarn install
yarn webiny deploy          # deploys to dev (~5-15 minutes first time)
yarn webiny info            # shows deployed URLs
```

Open the Admin URL shown in the output, complete the installation wizard (name, email,
password), and your CMS is ready.

## Deployment per environment

```bash
yarn webiny deploy --env dev
yarn webiny deploy --env stage
yarn webiny deploy --env prod
```

Credentials are picked up from the environment (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`)
or from your `~/.aws/config` profile. In CI, OIDC injects credentials before this runs.

## Makefile shortcuts

```bash
make deploy-dev    # yarn webiny deploy --env dev
make deploy-stage  # yarn webiny deploy --env stage
make deploy-prod   # yarn webiny deploy --env prod
make info-dev      # yarn webiny info --env dev
make destroy-dev   # yarn webiny destroy --env dev (dev only — intentionally)
```

## Wiring the Webiny API URL into the SvelteKit app

After deploying, get the GraphQL API URL:

```bash
yarn webiny info --env dev
# Output includes: apiUrl: https://<id>.cloudfront.net/graphql
```

Set these in the SvelteKit app for the matching stage:

```bash
# apps/web/.env.local (local dev — gitignored)
WEBINY_API_URL=https://<id>.cloudfront.net/graphql
WEBINY_API_KEY=<api-token-from-admin>

# Exposed to browser (read-only public endpoint only)
VITE_WEBINY_API_URL=https://<id>.cloudfront.net/graphql
```

Keep `WEBINY_API_KEY` server-side only — never prefix with `VITE_`.

For automated wiring (follow-on phase), the API URL can be stored in AWS SSM Parameter Store
after deploy and read by `sst.config.ts`:

```ts
// Future: auto-read Webiny API URL per stage
const webinyApiUrl = await aws.ssm.getParameter({
  name: `/sst-monorepo/${$app.stage}/webiny/api-url`,
});
```

## Extending Webiny

All customizations go in the `extensions/` folder and are registered in `webiny.config.tsx`.
Common extensions:

- **Content models** — define structured content types (blogs, products, etc.)
- **Lifecycle hooks** — run code on create/update/delete
- **Custom resolvers** — extend the GraphQL API
- **Custom UI plugins** — add screens to the Admin panel

See [Webiny extension docs](https://www.webiny.com/docs) for details.

## CI/CD

Webiny is deployed as a follow-on step inside the SST deploy jobs in
`.github/workflows/deploy.yml`. The same AWS OIDC role used for SST is reused for Webiny
(same AWS account per stage, same permissions). Node.js 24 is required.

## Useful commands

```bash
yarn webiny info --env dev         # show all deployed resource URLs
yarn webiny logs --env dev --tail  # stream live Lambda logs
yarn webiny destroy --env dev      # tear down dev environment
```
