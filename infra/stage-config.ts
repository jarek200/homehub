/// <reference path="../.sst/platform/config.d.ts" />

/**
 * Stage-aware configuration for all infrastructure resources.
 *
 * This is the single place to tune resource sizes, timeouts, and
 * feature flags per environment. Every infra module imports from here
 * rather than hardcoding values or branching on $app.stage individually.
 *
 * Usage:
 *   import { stageConfig } from './stage-config';
 *   new sst.aws.Function('Foo', { memory: stageConfig.lambda.memory, ... });
 */

type StageConfig = {
  lambda: {
    memory: `${number} MB`;
    timeout: `${number} seconds`;
  };
  sveltekit: {
    memory: `${number} MB`;
  };
  iot: {
    /** Skip IoT Core provisioning; mark devices READY for local UI demos. */
    skipProvisioning: boolean;
  };
};

const configs: Record<string, StageConfig> = {
  int: {
    lambda: { memory: '512 MB', timeout: '15 seconds' },
    sveltekit: { memory: '1024 MB' },
    iot: { skipProvisioning: false },
  },
  prod: {
    lambda: { memory: '1024 MB', timeout: '30 seconds' },
    sveltekit: { memory: '1024 MB' },
    iot: { skipProvisioning: false },
  },
};

/** Personal `sst dev` stages fall back to int sizing with provisioning stubbed. */
export const stageConfig: StageConfig = configs[$app.stage] ?? {
  ...configs.int,
  iot: { skipProvisioning: true },
};
