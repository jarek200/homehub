/// <reference path="../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import { IamPropagationDelay } from './iam-wait';
import { pythonCatalogCopy, pythonLambdaEnv } from './python-lambda';
import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];

type AppsyncPublish = {
  eventsHttpUrl: $util.Output<string>;
  namespaceArn: $util.Output<string>;
};

export function createIotTelemetry(
  table: StorageTable,
  iotEndpoint?: { endpointAddress: { apply: (fn: (host: string) => string) => string } },
  alertTopic?: aws.sns.Topic,
  appsync?: AppsyncPublish
) {
  const firmwareBucket = new aws.s3.Bucket('GatewayFirmware', {
    bucket: `${$app.name}-firmware-${$app.stage}`,
    forceDestroy: $app.stage !== 'prod',
  });

  new aws.s3.BucketPublicAccessBlock('GatewayFirmwarePublicAccessBlock', {
    bucket: firmwareBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });

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
    handler: 'services/api/src/homehub_api/iot/telemetry.handler',
    runtime: 'python3.13',
    copyFiles: pythonCatalogCopy,
    memory: stageConfig.lambda.memory,
    timeout: stageConfig.lambda.timeout,
    link: [table],
    environment: {
      ...pythonLambdaEnv,
      TABLE_NAME: table.name,
      ...(appsync ? { APPSYNC_EVENTS_HTTP_URL: appsync.eventsHttpUrl } : {}),
    },
    permissions: [
      {
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem', 'dynamodb:Query'],
        resources: [table.arn, $interpolate`${table.arn}/index/*`],
      },
      ...(appsync
        ? [
            {
              actions: ['appsync:EventPublish'],
              resources: [appsync.namespaceArn],
            },
          ]
        : []),
    ],
  });

  const telemetryFailureQueue = new aws.sqs.Queue('TelemetryRuleFailures', {
    messageRetentionSeconds: 14 * 24 * 60 * 60,
  });

  const telemetryFailureRole = new aws.iam.Role('TelemetryRuleFailureRole', {
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

  new aws.iam.RolePolicy('TelemetryRuleFailurePolicy', {
    role: telemetryFailureRole.id,
    policy: telemetryFailureQueue.arn.apply((queueArn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'sqs:SendMessage',
            Resource: queueArn,
          },
        ],
      })
    ),
  });

  const failureAction = {
    sqs: {
      queueUrl: telemetryFailureQueue.url,
      roleArn: telemetryFailureRole.arn,
      useBase64: false,
    },
  };

  const hotRule = new aws.iot.TopicRule('TelemetryHotRule', {
    name: `${$app.name}_${$app.stage}_telemetry_hot`,
    enabled: true,
    sql: `SELECT topic(4) AS deviceId, * FROM 'homehub/${$app.stage}/devices/+/telemetry'`,
    sqlVersion: '2016-03-23',
    errorAction: failureAction,
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
    sql: `SELECT topic(4) AS deviceid, hubId AS hubid, thingName AS thingname, timestamp() AS recordedat, alarm, state, metrics FROM 'homehub/${$app.stage}/devices/+/telemetry'`,
    sqlVersion: '2016-03-23',
    errorAction: failureAction,
    firehoses: [
      {
        deliveryStreamName: firehoseStream.name,
        roleArn: iotFirehoseRole.arn,
        separator: '\n',
      },
    ],
  });

  const alarmActions = alertTopic ? [alertTopic.arn] : [];

  new aws.cloudwatch.MetricAlarm('TelemetryWriterErrors', {
    name: `${$app.name}-${$app.stage}-telemetry-writer-errors`,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    evaluationPeriods: 1,
    metricName: 'Errors',
    namespace: 'AWS/Lambda',
    period: 300,
    statistic: 'Sum',
    threshold: 1,
    treatMissingData: 'notBreaching',
    dimensions: { FunctionName: telemetryWriter.nodes.function.name },
    alarmActions,
  });

  new aws.cloudwatch.MetricAlarm('TelemetryFailureQueueDepth', {
    name: `${$app.name}-${$app.stage}-telemetry-failure-queue-depth`,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    evaluationPeriods: 1,
    metricName: 'ApproximateNumberOfMessagesVisible',
    namespace: 'AWS/SQS',
    period: 300,
    statistic: 'Maximum',
    threshold: 1,
    treatMissingData: 'notBreaching',
    dimensions: { QueueName: telemetryFailureQueue.name },
    alarmActions,
  });

  new aws.cloudwatch.MetricAlarm('TelemetryHeartbeatMissing', {
    name: `${$app.name}-${$app.stage}-telemetry-heartbeat-missing`,
    comparisonOperator: 'LessThanThreshold',
    evaluationPeriods: 2,
    metricName: 'Invocations',
    namespace: 'AWS/Lambda',
    period: 300,
    statistic: 'Sum',
    threshold: 1,
    treatMissingData: 'breaching',
    dimensions: { FunctionName: telemetryWriter.nodes.function.name },
    alarmActions,
  });

  const gatewayStateWriter = new sst.aws.Function('GatewayStateWriter', {
    handler: 'services/api/src/homehub_api/iot/gateway_state.handler',
    runtime: 'python3.13',
    copyFiles: pythonCatalogCopy,
    memory: stageConfig.lambda.memory,
    timeout: stageConfig.lambda.timeout,
    link: [table],
    environment: {
      ...pythonLambdaEnv,
      TABLE_NAME: table.name,
      ...(iotEndpoint
        ? {
            IOT_DATA_ENDPOINT: iotEndpoint.endpointAddress.apply((host) => `https://${host}`),
          }
        : {}),
    },
    permissions: [
      {
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem', 'dynamodb:Query'],
        resources: [table.arn, $interpolate`${table.arn}/index/*`],
      },
      {
        actions: ['iot:Publish'],
        resources: ['*'],
      },
    ],
  });

  const gatewayStateRule = new aws.iot.TopicRule('GatewayStateRule', {
    name: `${$app.name}_${$app.stage}_gateway_state`,
    enabled: true,
    sql: "SELECT topic(3) AS gatewayId, * FROM 'homehub/gateways/+/state'",
    sqlVersion: '2016-03-23',
    lambdas: [
      {
        functionArn: gatewayStateWriter.arn,
      },
    ],
  });

  new aws.lambda.Permission('GatewayStateRulePermission', {
    action: 'lambda:InvokeFunction',
    function: gatewayStateWriter.arn,
    principal: 'iot.amazonaws.com',
    sourceArn: gatewayStateRule.arn,
  });

  const gatewayEventsRule = new aws.iot.TopicRule('GatewayEventsRule', {
    name: `${$app.name}_${$app.stage}_gateway_events`,
    enabled: true,
    sql: "SELECT topic(3) AS gatewayId, * FROM 'homehub/gateways/+/events'",
    sqlVersion: '2016-03-23',
    lambdas: [
      {
        functionArn: gatewayStateWriter.arn,
      },
    ],
  });

  new aws.lambda.Permission('GatewayEventsRulePermission', {
    action: 'lambda:InvokeFunction',
    function: gatewayStateWriter.arn,
    principal: 'iot.amazonaws.com',
    sourceArn: gatewayEventsRule.arn,
  });

  const householdAlertTopic = new aws.sns.Topic('HouseholdAlerts', {
    name: `${$app.name}-${$app.stage}-household-alerts`,
  });

  const alertEmail = process.env.ALERT_EMAIL?.trim();
  if (alertEmail) {
    new aws.sns.TopicSubscription('HouseholdAlertEmail', {
      topic: householdAlertTopic.arn,
      protocol: 'email',
      endpoint: alertEmail,
    });
  }

  const iotSnsRole = new aws.iam.Role('IotHouseholdAlertRole', {
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

  new aws.iam.RolePolicy('IotHouseholdAlertRolePolicy', {
    role: iotSnsRole.id,
    policy: householdAlertTopic.arn.apply((arn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'sns:Publish',
            Resource: arn,
          },
        ],
      })
    ),
  });

  const gatewayAlertsRule = new aws.iot.TopicRule('GatewayAlertsRule', {
    name: `${$app.name}_${$app.stage}_gateway_alerts`,
    enabled: true,
    sql: "SELECT topic(3) AS gatewayId, * FROM 'homehub/gateways/+/alerts'",
    sqlVersion: '2016-03-23',
    sns: [
      {
        targetArn: householdAlertTopic.arn,
        roleArn: iotSnsRole.arn,
        messageFormat: 'RAW',
      },
    ],
  });

  return {
    firmwareBucket,
    telemetryBucket,
    athenaResultsBucket,
    glueDatabase,
    glueTable,
    firehoseStream,
    telemetryWriter,
    telemetryFailureQueue,
    hotRule,
    coldRule,
    gatewayStateWriter,
    gatewayStateRule,
    householdAlertTopic,
    gatewayAlertsRule,
  };
}
