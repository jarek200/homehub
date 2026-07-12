/// <reference path="../../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];

export function createIotProvisioning(table: StorageTable) {
  const simulatorQueue = new sst.aws.Queue('SimulatorEvents', {
    visibilityTimeout: '2 minutes',
  });

  const iotPolicy = new aws.iot.Policy('SimulatorIotPolicy', {
    name: `${$app.name}-${$app.stage}-simulator`,
    policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['iot:Connect', 'iot:Publish', 'iot:Subscribe', 'iot:Receive'],
          Resource: ['*'],
        },
      ],
    }),
  });

  const iotEndpoint = aws.iot.getEndpointOutput({ endpointType: 'iot:Data-ATS' });

  const provisionFunction = new sst.aws.Function('ProvisionDevice', {
    handler: 'packages/rest-api/src/homehub_api/iot/provision.handler',
    runtime: 'python3.13',
    memory: stageConfig.lambda.memory,
    timeout: '60 seconds',
    link: [table, simulatorQueue],
    environment: {
      TABLE_NAME: table.name,
      SIMULATOR_QUEUE_URL: simulatorQueue.url,
      IOT_POLICY_NAME: iotPolicy.name,
      IOT_DATA_ENDPOINT: iotEndpoint.endpointAddress.apply((host) => `https://${host}`),
      SKIP_IOT_PROVISIONING: stageConfig.iot.skipProvisioning ? 'true' : 'false',
    },
    permissions: [
      {
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
        resources: [table.arn, $interpolate`${table.arn}/index/*`],
      },
      {
        actions: ['sqs:SendMessage'],
        resources: [simulatorQueue.arn],
      },
      {
        actions: [
          'iot:CreateThing',
          'iot:AttachPolicy',
          'iot:DescribeEndpoint',
          'iot:UpdateThingShadow',
        ],
        resources: ['*'],
      },
    ],
  });

  table.subscribe('DeviceProvisioner', provisionFunction.arn, {
    filters: [
      {
        eventName: ['INSERT'],
        dynamodb: {
          Keys: {
            SK: { S: [{ prefix: 'DEVICE#' }] },
          },
          NewImage: {
            lifecycleStatus: { S: ['PROVISIONING'] },
          },
        },
      },
    ],
    transform: {
      eventSourceMapping: {
        batchSize: 1,
        startingPosition: 'LATEST',
      },
    },
  });

  return {
    simulatorQueue,
    iotPolicy,
    iotEndpoint,
    provisionFunction,
  };
}
