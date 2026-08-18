---
name: homehub-deploy-int
description: >-
  Deploy HomeHub to the shared int stage with the custom domain
  homehub-int.apps.jarekwyprzal.com. Use when the user asks to deploy int,
  run deploy:int, restore the int URL, or deploy from a local machine without
  losing the custom domain.
---

# HomeHub int deploy

Local `pnpm deploy:int` must preserve the custom domain. A bare `sst deploy --stage int` without domain env vars deploys to a random CloudFront URL.

## Always use the wrapper

```bash
pnpm sso
pnpm deploy:int
```

This runs [scripts/deploy-int.sh](../../scripts/deploy-int.sh), which:

1. Forces `AWS_PROFILE=homehub-int` (ignores a shell `AWS_PROFILE=prod`)
2. Loads `APP_URL` from `.env.local`, `APP_URL_INT`, or `gh variable get APP_URL_INT`
3. Loads `APPS_HOSTED_ZONE_ID` from `.env.local` or GitHub repo variables
4. Exports DNS credentials from the `admin` profile into `DNS_AWS_*` for Route53 + ACM
5. Runs `sst unlock --stage int` then `sst deploy --stage int`

## Expected URLs after success

| Output | Value |
|--------|-------|
| `webUrl` / `webAppUrl` | `https://homehub-int.apps.jarekwyprzal.com` |
| `restApiUrl` | `https://….execute-api.eu-west-1.amazonaws.com` |

If `webUrl` is a `*.cloudfront.net` hostname, the domain env vars were missing — redeploy with the wrapper.

## Manual deploy (only if the script fails)

```bash
pnpm sso

eval "$(aws configure export-credentials --profile admin --format env)"
export DNS_AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
export DNS_AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
export DNS_AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN"
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

export APP_URL="https://homehub-int.apps.jarekwyprzal.com"
export APPS_HOSTED_ZONE_ID="Z09755473NAKQH1DTPX19"

AWS_PROFILE=homehub-int pnpm exec sst unlock --stage int
AWS_PROFILE=homehub-int pnpm exec sst deploy --stage int
```

## Verify

```bash
curl -sI https://homehub-int.apps.jarekwyprzal.com | head -5
```

Expect HTTP 307 to `/login` and a valid TLS certificate.

## GitHub Actions

PR label `deploy:int` already sets `APP_URL`, `APPS_HOSTED_ZONE_ID`, and `DNS_ROLE_ARN`. Do not change the workflow when fixing local deploys.

## Common mistakes

- **`AWS_PROFILE=prod` in the shell** — deploys to the wrong account and breaks bucket names
- **Missing DNS credentials** — app works on CloudFront default URL only; custom domain has no alias/cert
- **`sst refresh` without domain env** — can desync state; prefer `deploy-int.sh`
