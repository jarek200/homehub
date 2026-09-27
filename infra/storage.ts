/// <reference path="../.sst/platform/config.d.ts" />

export function createStorage() {
  // DynamoDB Table
  const table = new sst.aws.Dynamo('AppTable', {
    fields: {
      PK: 'string',
      SK: 'string',
    },
    primaryIndex: { hashKey: 'PK', rangeKey: 'SK' },
    ttl: 'expiresAt',
    deletionProtection: $app.stage === 'prod',
    stream: 'new-and-old-images',
    transform: {
      table: (args) => {
        args.pointInTimeRecovery = {
          enabled: $app.stage === 'prod',
        };
      },
    },
  });

  return { table };
}
