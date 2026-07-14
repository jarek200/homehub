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

const skipIotProvisioning = process.env.HOMEHUB_SKIP_IOT_PROVISIONING === 'true';

type StageConfig = {
  lambda: {
    memory: `${number} MB`;
    timeout: `${number} seconds`;
  };
  sveltekit: {
    memory: `${number} MB`;
  };
  iot: {
    /** Set HOMEHUB_SKIP_IOT_PROVISIONING=true to stub provisioning (READY without IoT). */
    skipProvisioning: boolean;
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
    lambda: { memory: '512 MB', timeout: '15 seconds' },
    sveltekit: { memory: '1024 MB' },
    iot: { skipProvisioning: skipIotProvisioning },
    deviceSimulator: {
      enabled: !skipIotProvisioning && deviceSimulatorStages.has('int'),
      power: 'nano',
      scale: 1,
    },
  },
  prod: {
    lambda: { memory: '1024 MB', timeout: '30 seconds' },
    sveltekit: { memory: '1024 MB' },
    iot: { skipProvisioning: skipIotProvisioning },
    deviceSimulator: {
      enabled: !skipIotProvisioning && deviceSimulatorStages.has('prod'),
      power: 'nano',
      scale: 1,
    },
  },
};

/** All stages (including personal `sst dev`) use full IoT unless HOMEHUB_SKIP_IOT_PROVISIONING=true. */
export const stageConfig: StageConfig = configs[$app.stage] ?? {
  ...configs.int,
  iot: { skipProvisioning: skipIotProvisioning },
  deviceSimulator: {
    enabled: false,
    power: 'nano',
    scale: 1,
  },
};
