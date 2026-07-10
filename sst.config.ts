/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Stage-to-AWS-profile mapping for local development.
 *
 * In CI the profile is irrelevant — OIDC credentials are injected via
 * aws-actions/configure-aws-credentials and take precedence over any profile
 * set here (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars override
 * providers.aws.profile per SST docs).
 *
 * For local SSO setup follow: https://sst.dev/docs/aws-accounts
 * Update the profile names below to match your ~/.aws/config entries.
 *
 * You can also override per-stage profiles via env vars without touching
 * this file:
 *   AWS_PROFILE_INT=homehub-int pnpm exec sst deploy --stage int
 *
 * Accounts:
 *   int  (and personal sst dev stages) → homehub-int  (800309353529)
 *   prod                               → homehub-prod (570064632535)
 *
 * Log in first: pnpm sso
 */
const STAGE_PROFILES: Record<string, string> = {
  int: process.env.AWS_PROFILE_INT ?? 'homehub-int',
  prod: process.env.AWS_PROFILE_PROD ?? 'homehub-prod',
};

export default $config({
  app(input) {
    const stage = input?.stage ?? 'dev';

    return {
      name: 'sst-monorepo-starter',
      /**
       * Retain all resources in prod to prevent accidental data loss.
       * All other stages (dev, stage, feature branches) are cleaned up on remove.
       */
      removal: stage === 'prod' ? 'retain' : 'remove',
      home: 'aws',
      providers: {
        aws: {
          /**
           * Map stage name to an AWS profile for local development only.
           * In CI (GitHub Actions sets CI=true) we omit the profile entirely so
           * the Pulumi AWS provider uses the OIDC credentials injected via
           * aws-actions/configure-aws-credentials (env vars take precedence
           * only when no profile is explicitly configured in the provider).
           *
           * IMPORTANT: AWS_PROFILE env var takes precedence over this value.
           * Remove any AWS_PROFILE from your shell / .env if you want this
           * mapping to be effective locally.
           */
          profile: process.env.CI ? undefined : (STAGE_PROFILES[stage] ?? STAGE_PROFILES.int),
        },
      },
    };
  },
  async run() {
    const { getWebAppUrl, getWebDomainConfig } = await import('./infra/app-domain');
    const { createStorage } = await import('./infra/storage');
    const { createUserProfile } = await import('./infra/functions');
    const { createAuth } = await import('./infra/auth');
    const { createApi, createDataSource } = await import('./infra/api/api-setup');
    const { addAllResolvers } = await import('./infra/api/resolvers');
    const { createRestApi } = await import('./infra/rest-api');
    const { stageConfig } = await import('./infra/stage-config');

    const { table } = createStorage();
    const createUserProfileFunction = createUserProfile(table);
    const { auth, authClient } = createAuth(createUserProfileFunction);
    const api = createApi(auth);
    const dynamoDataSource = createDataSource(api, table);
    const restApi = createRestApi(table);

    addAllResolvers(api, dynamoDataSource, String(table.name));

    const webAppUrl = getWebAppUrl();
    const webDomain = getWebDomainConfig();

    const svelteKitTransform = {
      server(server: Record<string, unknown>) {
        server.runtime = 'nodejs24.x';
        server.memory = stageConfig.sveltekit.memory;
        // biome-ignore lint/suspicious/noExplicitAny: SST types incomplete
        if (!server.nodejs) server.nodejs = {} as any;
        // biome-ignore lint/suspicious/noExplicitAny: SST types incomplete
        const nodejs = server.nodejs as any;
        const existingExternal = ((nodejs.esbuild?.external as string[] | undefined) ?? []).slice();
        nodejs.loader = { ...(nodejs.loader ?? {}), '.node': 'file' };
        nodejs.esbuild = {
          ...(nodejs.esbuild ?? {}),
          external: Array.from(new Set([...existingExternal, 'fsevents', 'lightningcss'])),
        };
      },
    };

    const sharedEnv = {
      VITE_AWS_REGION: aws.getRegionOutput().name,
      VITE_USER_POOL_ID: auth.id,
      VITE_USER_POOL_CLIENT_ID: authClient.id,
      VITE_GRAPHQL_ENDPOINT: api.url,
      VITE_REST_API_URL: restApi.url,
      VITE_STAGE: $app.stage,
      VITE_APP_URL: webAppUrl,
    };

    const web = new sst.aws.SvelteKit('Web', {
      path: 'apps/web',
      link: [table, auth, authClient, api],
      transform: svelteKitTransform,
      environment: sharedEnv,
      ...(webDomain ? { domain: webDomain } : {}),
    });

    return {
      table: table.name,
      userPoolId: auth.id,
      userPoolClientId: authClient.id,
      apiUrl: api.url,
      restApiUrl: restApi.url,
      webUrl: web.url,
      webAppUrl: webAppUrl ?? web.url,
    };
  },
});
