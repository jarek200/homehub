/// <reference path="../.sst/platform/config.d.ts" />

import * as pulumi from '@pulumi/pulumi';

/**
 * Blocks create until IAM role/policy changes have had time to propagate.
 * Firehose CreateDeliveryStream often fails with "security token … invalid /
 * role … not deleted" when the role was created milliseconds earlier.
 */
class IamPropagationDelayProvider implements pulumi.dynamic.ResourceProvider {
  async create(inputs: { seconds: number }): Promise<pulumi.dynamic.CreateResult> {
    const seconds = Math.max(1, Number(inputs.seconds) || 20);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return {
      id: `iam-wait-${seconds}-${Date.now()}`,
      outs: { seconds },
    };
  }
}

export class IamPropagationDelay extends pulumi.dynamic.Resource {
  constructor(name: string, seconds: number, opts?: pulumi.CustomResourceOptions) {
    super(new IamPropagationDelayProvider(), name, { seconds }, opts);
  }
}
