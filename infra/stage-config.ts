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
  deviceSimulator: {
    /** Lightsail container service for MQTT simulator (int/prod only). */
    enabled: boolean;
    power: 'nano' | 'micro' | 'small' | 'medium' | 'large' | 'xlarge';
    scale: number;
  };
};

const deviceSimulatorStages = new Set(['int', 'prod']);

const configs: Record<string, StageConfig> = {
  int: {
    lambda: { memory: '512 MB', timeout: '30 seconds' },
    sveltekit: { memory: '1024 MB' },
    deviceSimulator: {
      enabled: deviceSimulatorStages.has('int'),
      power: 'nano',
      scale: 1,
    },
  },
  prod: {
    lambda: { memory: '1024 MB', timeout: '30 seconds' },
    sveltekit: { memory: '1024 MB' },
    deviceSimulator: {
      enabled: deviceSimulatorStages.has('prod'),
      power: 'nano',
      scale: 1,
    },
  },
};

/** Personal `sst dev` stages inherit int sizing but never provision Lightsail. */
export const stageConfig: StageConfig = configs[$app.stage] ?? {
  ...configs.int,
  deviceSimulator: {
    enabled: false,
    power: 'nano',
    scale: 1,
  },
};
