/// <reference path="../../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import { pythonLambdaEnv } from './python-lambda';
import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];
type IotProvisioning = ReturnType<typeof import('./iot-provisioning').createIotProvisioning>;
type IotTelemetry = ReturnType<typeof import('./iot-telemetry').createIotTelemetry>;

export function createRestApi(
  table: StorageTable,
  auth: ReturnType<typeof import('./auth').createAuth>['auth'],
  iotProvisioning?: Pick<IotProvisioning, 'simulatorQueue' | 'iotPolicy'>,
  iotTelemetry?: Pick<
    IotTelemetry,
    'telemetryBucket' | 'athenaResultsBucket' | 'glueDatabase' | 'glueTable'
  >
) {
  const api = new sst.aws.ApiGatewayV2('DeviceRestApi', {
    cors: {
      allowOrigins: ['*'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Api-Key', 'Authorization'],
    },
  });

  const athenaEnv = iotTelemetry
    ? {
        ATHENA_DATABASE: iotTelemetry.glueDatabase.name,
        ATHENA_TABLE: iotTelemetry.glueTable.name,
        ATHENA_OUTPUT: iotTelemetry.athenaResultsBucket.bucket.apply(
          (name) => `s3://${name}/results/`
        ),
        ATHENA_WORKGROUP: 'primary',
      }
    : {};

  const athenaPermissions = iotTelemetry
    ? [
        {
          actions: [
            'athena:StartQueryExecution',
            'athena:GetQueryExecution',
            'athena:GetQueryResults',
            'athena:StopQueryExecution',
          ],
          resources: ['*'],
        },
        {
          actions: [
            'glue:GetDatabase',
            'glue:GetTable',
            'glue:GetTables',
            'glue:GetPartition',
            'glue:GetPartitions',
          ],
          resources: ['*'],
        },
        {
          actions: ['s3:GetObject', 's3:ListBucket', 's3:GetBucketLocation'],
          resources: [
            iotTelemetry.telemetryBucket.arn,
            $interpolate`${iotTelemetry.telemetryBucket.arn}/*`,
          ],
        },
        {
          actions: [
            's3:GetObject',
            's3:PutObject',
            's3:ListBucket',
            's3:GetBucketLocation',
            's3:AbortMultipartUpload',
          ],
          resources: [
            iotTelemetry.athenaResultsBucket.arn,
            $interpolate`${iotTelemetry.athenaResultsBucket.arn}/*`,
          ],
        },
      ]
    : [];

  const routeArgs = {
    handler: 'packages/rest-api/src/homehub_api/handler.handler',
    runtime: 'python3.13' as const,
    memory: stageConfig.lambda.memory,
    timeout: stageConfig.lambda.timeout,
    link: [table],
    environment: {
      ...pythonLambdaEnv,
      TABLE_NAME: table.name,
      REST_API_KEY: process.env.REST_API_KEY ?? '',
      COGNITO_USER_POOL_ID: auth.id,
      POWERTOOLS_SERVICE_NAME: 'homehub-api',
      POWERTOOLS_METRICS_NAMESPACE: 'HomeHub',
      POWERTOOLS_LOG_LEVEL: 'INFO',
      ...athenaEnv,
      ...(iotProvisioning
        ? {
            SIMULATOR_QUEUE_URL: iotProvisioning.simulatorQueue.url,
            IOT_POLICY_NAME: iotProvisioning.iotPolicy.name,
            IOT_DATA_ENDPOINT: iotProvisioning.iotEndpoint.endpointAddress.apply(
              (host) => `https://${host}`
            ),
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
          'dynamodb:DescribeTable',
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
              actions: ['iot:UpdateThingShadow'],
              resources: ['*'],
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
      ...athenaPermissions,
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
