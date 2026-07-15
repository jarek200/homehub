/// <reference path="../../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import { IamPropagationDelay } from './iam-wait';
import { pythonLambdaEnv } from './python-lambda';
import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];

export function createIotTelemetry(table: StorageTable) {
  const telemetryBucket = new aws.s3.Bucket('TelemetryLake', {
    bucket: `${$app.name}-telemetry-${$app.stage}`,
    forceDestroy: $app.stage !== 'prod',
  });

  new aws.s3.BucketPublicAccessBlock('TelemetryLakePublicAccessBlock', {
    bucket: telemetryBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });

  const glueDatabase = new aws.glue.CatalogDatabase('TelemetryGlueDb', {
    name: `${$app.name}_${$app.stage}_telemetry`,
  });

  const glueTable = new aws.glue.CatalogTable('TelemetryGlueTable', {
    databaseName: glueDatabase.name,
    name: 'device_telemetry',
    tableType: 'EXTERNAL_TABLE',
    parameters: telemetryBucket.bucket.apply((name) => ({
      classification: 'parquet',
      'projection.enabled': 'true',
      'projection.hub.type': 'injected',
      'projection.year.type': 'integer',
      'projection.year.range': '2024,2035',
      'projection.year.digits': '4',
      'projection.month.type': 'integer',
      'projection.month.range': '1,12',
      'projection.month.digits': '2',
      'projection.day.type': 'integer',
      'projection.day.range': '1,31',
      'projection.day.digits': '2',
      'storage.location.template': `s3://${name}/telemetry/hub=\${hub}/year=\${year}/month=\${month}/day=\${day}`,
    })),
    storageDescriptor: {
      location: telemetryBucket.bucket.apply((name) => `s3://${name}/telemetry/`),
      inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
      outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
      serDeInfo: {
        serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
      },
      columns: [
        { name: 'hubid', type: 'string' },
        { name: 'deviceid', type: 'string' },
        { name: 'thingname', type: 'string' },
        { name: 'alarm', type: 'boolean' },
        { name: 'state', type: 'string' },
        { name: 'metrics', type: 'string' },
        { name: 'recordedat', type: 'string' },
      ],
    },
    partitionKeys: [
      { name: 'hub', type: 'string' },
      { name: 'year', type: 'string' },
      { name: 'month', type: 'string' },
      { name: 'day', type: 'string' },
    ],
  });

  const athenaResultsBucket = new aws.s3.Bucket('AthenaResults', {
    bucket: `${$app.name}-athena-results-${$app.stage}`,
    forceDestroy: $app.stage !== 'prod',
  });

  new aws.s3.BucketPublicAccessBlock('AthenaResultsPublicAccessBlock', {
    bucket: athenaResultsBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });

  const firehoseRole = new aws.iam.Role('TelemetryFirehoseRole', {
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'firehose.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    }),
  });

  const firehoseRolePolicy = new aws.iam.RolePolicy('TelemetryFirehoseRolePolicy', {
    role: firehoseRole.id,
    policy: telemetryBucket.arn.apply((bucketArn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              's3:AbortMultipartUpload',
              's3:GetBucketLocation',
              's3:GetObject',
              's3:ListBucket',
              's3:ListBucketMultipartUploads',
              's3:PutObject',
            ],
            Resource: [bucketArn, `${bucketArn}/*`],
          },
          {
            Effect: 'Allow',
            Action: ['glue:GetTable', 'glue:GetTableVersion', 'glue:GetTableVersions'],
            Resource: ['*'],
          },
        ],
      })
    ),
  });

  // IAM is eventually consistent; Firehose assumes the role during create.
  const waitForFirehoseRole = new IamPropagationDelay('TelemetryFirehoseIamWait', 20, {
    dependsOn: [firehoseRole, firehoseRolePolicy],
  });

  const firehoseStream = new aws.kinesis.FirehoseDeliveryStream(
    'TelemetryFirehose',
    {
      name: `${$app.name}-${$app.stage}-telemetry`,
      destination: 'extended_s3',
      extendedS3Configuration: {
        roleArn: firehoseRole.arn,
        bucketArn: telemetryBucket.arn,
        prefix:
          'telemetry/hub=!{partitionKeyFromQuery:hubid}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        errorOutputPrefix:
          'errors/!{firehose:error-output-type}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        bufferingSize: 64,
        bufferingInterval: 60,
        dynamicPartitioningConfiguration: {
          enabled: true,
        },
        processingConfiguration: {
          enabled: true,
          processors: [
            {
              type: 'MetadataExtraction',
              parameters: [
                {
                  parameterName: 'MetadataExtractionQuery',
                  parameterValue: '{hubid:.hubid}',
                },
                {
                  parameterName: 'JsonParsingEngine',
                  parameterValue: 'JQ-1.6',
                },
              ],
            },
          ],
        },
        dataFormatConversionConfiguration: {
          enabled: true,
          inputFormatConfiguration: {
            deserializer: {
              openXJsonSerDe: {},
            },
          },
          outputFormatConfiguration: {
            serializer: {
              parquetSerDe: {},
            },
          },
          schemaConfiguration: {
            roleArn: firehoseRole.arn,
            databaseName: glueDatabase.name,
            tableName: glueTable.name,
            region: aws.getRegionOutput().name,
          },
        },
      },
    },
    { dependsOn: [waitForFirehoseRole, firehoseRolePolicy, glueTable] }
  );

  const telemetryWriter = new sst.aws.Function('TelemetryWriter', {
    handler: 'packages/rest-api/src/homehub_api/iot/telemetry.handler',
    runtime: 'python3.13',
    memory: stageConfig.lambda.memory,
    timeout: stageConfig.lambda.timeout,
    link: [table],
    environment: {
      ...pythonLambdaEnv,
      TABLE_NAME: table.name,
    },
    permissions: [
      {
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem', 'dynamodb:Query'],
        resources: [table.arn, $interpolate`${table.arn}/index/*`],
      },
    ],
  });

  const hotRule = new aws.iot.TopicRule('TelemetryHotRule', {
    name: `${$app.name}_${$app.stage}_telemetry_hot`,
    enabled: true,
    sql: "SELECT topic(3) AS deviceId, * FROM 'homehub/devices/+/telemetry'",
    sqlVersion: '2016-03-23',
    lambdas: [
      {
        functionArn: telemetryWriter.arn,
      },
    ],
  });

  new aws.lambda.Permission('TelemetryHotRulePermission', {
    action: 'lambda:InvokeFunction',
    function: telemetryWriter.arn,
    principal: 'iot.amazonaws.com',
    sourceArn: hotRule.arn,
  });

  const iotFirehoseRole = new aws.iam.Role('IotFirehoseRole', {
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'iot.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    }),
  });

  new aws.iam.RolePolicy('IotFirehoseRolePolicy', {
    role: iotFirehoseRole.id,
    policy: firehoseStream.arn.apply((arn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
            Resource: arn,
          },
        ],
      })
    ),
  });

  const coldRule = new aws.iot.TopicRule('TelemetryColdRule', {
    name: `${$app.name}_${$app.stage}_telemetry_cold`,
    enabled: true,
    sql: "SELECT topic(3) AS deviceid, hubId AS hubid, thingName AS thingname, timestamp() AS recordedat, alarm, state, metrics FROM 'homehub/devices/+/telemetry'",
    sqlVersion: '2016-03-23',
    firehoses: [
      {
        deliveryStreamName: firehoseStream.name,
        roleArn: iotFirehoseRole.arn,
        separator: '\n',
      },
    ],
  });

  return {
    telemetryBucket,
    athenaResultsBucket,
    glueDatabase,
    glueTable,
    firehoseStream,
    telemetryWriter,
    hotRule,
    coldRule,
  };
}
