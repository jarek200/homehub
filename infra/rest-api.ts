/// <reference path="../../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];
type IotProvisioning = ReturnType<typeof import('./iot-provisioning').createIotProvisioning>;

export function createRestApi(
  table: StorageTable,
  auth: ReturnType<typeof import('./auth').createAuth>['auth'],
  iotProvisioning?: Pick<IotProvisioning, 'simulatorQueue' | 'iotPolicy'>
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
      ...(iotProvisioning
        ? {
            SIMULATOR_QUEUE_URL: iotProvisioning.simulatorQueue.url,
            IOT_POLICY_NAME: iotProvisioning.iotPolicy.name,
          }
        : {}),
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
      ...(iotProvisioning
        ? [
            {
              actions: ['sqs:SendMessage'],
              resources: [iotProvisioning.simulatorQueue.arn],
            },
            {
              actions: [
                'iot:UpdateCertificate',
                'iot:DeleteCertificate',
                'iot:DescribeCertificate',
                'iot:DetachPolicy',
                'iot:DetachThingPrincipal',
                'iot:DeleteThing',
              ],
              resources: ['*'],
            },
            {
              actions: ['ssm:DeleteParameter'],
              resources: [
                $interpolate`arn:aws:ssm:${aws.getRegionOutput().name}:${aws.getCallerIdentityOutput().accountId}:parameter/homehub/devices/*`,
              ],
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
