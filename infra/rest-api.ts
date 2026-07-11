/// <reference path="../../.sst/platform/config.d.ts" />

import { stageConfig } from './stage-config';

export function createRestApi(
  table: ReturnType<typeof import('./storage').createStorage>['table']
) {
  const api = new sst.aws.ApiGatewayV2('DeviceRestApi', {
    cors: {
      allowOrigins: ['*'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Api-Key'],
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
      POWERTOOLS_SERVICE_NAME: 'homehub-api',
      POWERTOOLS_METRICS_NAMESPACE: 'HomeHub',
      POWERTOOLS_LOG_LEVEL: 'INFO',
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
