/// <reference path="../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import type { Output } from '@pulumi/pulumi';
import { pythonLambdaEnv } from './python-lambda';
import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];
type IotProvisioning = ReturnType<typeof import('./iot-provisioning').createIotProvisioning>;
type IotTelemetry = ReturnType<typeof import('./iot-telemetry').createIotTelemetry>;
type SnapshotBucket = aws.s3.Bucket;

export function createRestApi(
  table: StorageTable,
  auth: ReturnType<typeof import('./auth').createAuth>['auth'],
  iotProvisioning?: Pick<IotProvisioning, 'iotPolicy' | 'gatewayIotPolicy' | 'iotEndpoint'>,
  iotTelemetry?: Pick<
    IotTelemetry,
    'firmwareBucket' | 'telemetryBucket' | 'athenaResultsBucket' | 'glueDatabase' | 'glueTable'
  >,
  snapshotBucket?: SnapshotBucket,
  email?: { fromAddress: string },
  restApiKey?: { value: Output<string> }
) {
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
  const api = new sst.aws.ApiGatewayV2('DeviceRestApi', {
    cors: {
      allowOrigins: appUrl ? [appUrl, 'http://localhost:3000', 'http://127.0.0.1:3000'] : ['*'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

  const region = aws.getRegionOutput().name;
  const accountId = aws.getCallerIdentityOutput().accountId;
  const athenaPermissions = iotTelemetry
    ? [
        {
          actions: [
            'athena:StartQueryExecution',
            'athena:GetQueryExecution',
            'athena:GetQueryResults',
            'athena:StopQueryExecution',
          ],
          resources: [$interpolate`arn:aws:athena:${region}:${accountId}:workgroup/primary`],
        },
        {
          actions: [
            'glue:GetDatabase',
            'glue:GetTable',
            'glue:GetTables',
            'glue:GetPartition',
            'glue:GetPartitions',
          ],
          resources: [
            $interpolate`arn:aws:glue:${region}:${accountId}:catalog`,
            $interpolate`arn:aws:glue:${region}:${accountId}:database/${iotTelemetry.glueDatabase.name}`,
            $interpolate`arn:aws:glue:${region}:${accountId}:table/${iotTelemetry.glueDatabase.name}/*`,
          ],
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
    handler: 'services/api/src/homehub_api/handler.handler',
    runtime: 'python3.13' as const,
    memory: stageConfig.lambda.memory,
    timeout: stageConfig.lambda.timeout,
    link: [table],
    environment: {
      ...pythonLambdaEnv,
      TABLE_NAME: table.name,
      REST_API_KEY: restApiKey?.value ?? '',
      COGNITO_USER_POOL_ID: auth.id,
      APP_URL: process.env.APP_URL ?? '',
      SES_FROM_ADDRESS: email?.fromAddress ?? '',
      POWERTOOLS_SERVICE_NAME: 'homehub-api',
      POWERTOOLS_METRICS_NAMESPACE: 'HomeHub',
      POWERTOOLS_LOG_LEVEL: 'INFO',
      ...athenaEnv,
      ...(iotTelemetry ? { FIRMWARE_BUCKET: iotTelemetry.firmwareBucket.bucket } : {}),
      ...(snapshotBucket ? { SNAPSHOT_BUCKET: snapshotBucket.bucket } : {}),
      ...(iotProvisioning
        ? {
            IOT_POLICY_NAME: iotProvisioning.iotPolicy.name,
            GATEWAY_IOT_POLICY_NAME: iotProvisioning.gatewayIotPolicy.name,
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
          'dynamodb:TransactWriteItems',
          'dynamodb:DescribeTable',
        ],
        resources: [table.arn, $interpolate`${table.arn}/index/*`],
      },
      ...(iotProvisioning
        ? [
            {
              // IoT data-plane Publish and UpdateThingShadow do not support resource-level ARNs.
              actions: ['iot:UpdateThingShadow', 'iot:Publish'],
              resources: ['*'],
            },
            {
              // Certificate APIs require a resource of * in IAM.
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
      ...(iotTelemetry
        ? [
            {
              actions: ['s3:GetObject'],
              resources: [$interpolate`${iotTelemetry.firmwareBucket.arn}/*`],
            },
          ]
        : []),
      ...(snapshotBucket
        ? [
            {
              actions: ['s3:GetObject'],
              resources: [$interpolate`${snapshotBucket.arn}/*`],
            },
            {
              actions: ['s3:ListBucket'],
              resources: [snapshotBucket.arn],
            },
          ]
        : []),
      {
        // X-Ray PutTraceSegments does not support resource-level permissions.
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        resources: ['*'],
      },
      ...(process.env.APP_DOMAIN?.trim()
        ? [
            {
              actions: ['ses:SendEmail', 'ses:SendRawEmail'],
              resources: [
                $interpolate`arn:aws:ses:${region}:${accountId}:identity/${process.env.APP_DOMAIN.trim().toLowerCase()}`,
              ],
            },
          ]
        : []),
      {
        actions: [
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:CreateGroup',
          'cognito-idp:GetGroup',
          'cognito-idp:AdminUserGlobalSignOut',
        ],
        resources: [auth.arn, $interpolate`${auth.arn}/*`],
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
