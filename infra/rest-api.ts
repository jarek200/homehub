/// <reference path="../../.sst/platform/config.d.ts" />

import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];
type SimulatorQueue = ReturnType<
  typeof import('./iot-provisioning').createIotProvisioning
>['simulatorQueue'];

export function createRestApi(
  table: StorageTable,
  auth: ReturnType<typeof import('./auth').createAuth>['auth'],
  simulatorQueue?: SimulatorQueue
) {
  const api = new sst.aws.ApiGatewayV2('DeviceRestApi', {
    cors: {
      allowOrigins: ['*'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Api-Key', 'Authorization'],
    },
  });

  const routeArgs = {
    handler: 'packages/rest-api/src/homehub_api/handler.handler',
    runtime: 'python3.13' as const,
    memory: stageConfig.lambda.memory,
    timeout: stageConfig.lambda.timeout,
    link: [table],
    environment: {
      TABLE_NAME: table.name,
      REST_API_KEY: process.env.REST_API_KEY ?? '',
      COGNITO_USER_POOL_ID: auth.id,
      POWERTOOLS_SERVICE_NAME: 'homehub-api',
      POWERTOOLS_METRICS_NAMESPACE: 'HomeHub',
      POWERTOOLS_LOG_LEVEL: 'INFO',
      ...(simulatorQueue ? { SIMULATOR_QUEUE_URL: simulatorQueue.url } : {}),
    },
    permissions: [
      {
        actions: [
          'dynamodb:Query',
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        resources: [table.arn, $interpolate`${table.arn}/index/*`],
      },
      ...(simulatorQueue
        ? [
            {
              actions: ['sqs:SendMessage'],
              resources: [simulatorQueue.arn],
            },
          ]
        : []),
      {
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        resources: ['*'],
      },
    ],
    transform: {
      function: {
        tracingConfig: {
          mode: 'Active',
        },
      },
    },
  };

  api.route('$default', routeArgs);

  return api;
}
