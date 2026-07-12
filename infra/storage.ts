/// <reference path="../.sst/platform/config.d.ts" />

export function createStorage() {
  // DynamoDB Table
  const table = new sst.aws.Dynamo('AppTable', {
    fields: {
      PK: 'string',
      SK: 'string',
      GSI1PK: 'string',
      GSI1SK: 'string',
      GSI2PK: 'string',
      GSI2SK: 'string',
    },
    primaryIndex: { hashKey: 'PK', rangeKey: 'SK' },
    globalIndexes: {
      GSI1: { hashKey: 'GSI1PK', rangeKey: 'GSI1SK' },
      GSI2: { hashKey: 'GSI2PK', rangeKey: 'GSI2SK' },
    },
    deletionProtection: $app.stage === 'prod',
    stream: 'new-and-old-images',
  });

  return { table };
}
