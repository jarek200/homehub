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
};

const configs: Record<string, StageConfig> = {
  dev: {
    lambda: { memory: '256 MB', timeout: '10 seconds' },
    sveltekit: { memory: '512 MB' },
  },
  stage: {
    lambda: { memory: '512 MB', timeout: '15 seconds' },
    sveltekit: { memory: '1024 MB' },
  },
  prod: {
    lambda: { memory: '1024 MB', timeout: '30 seconds' },
    sveltekit: { memory: '1024 MB' },
  },
};

export const stageConfig: StageConfig = configs[$app.stage] ?? configs.dev;
