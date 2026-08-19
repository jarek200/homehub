/// <reference path="../../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { pythonLambdaEnv } from './python-lambda';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];
type IotProvisioning = ReturnType<typeof import('./iot-provisioning').createIotProvisioning>;

/**
 * IAM + snapshot storage for the MQTT device runtime (Pi Docker / local compose).
 * Lightsail is not used — deploy the container with `pnpm device:deploy`.
 */
export function createDeviceRuntime(
  table: StorageTable,
  iotProvisioning: Pick<IotProvisioning, 'simulatorQueue'>
) {
  const region = aws.getRegionOutput().name;
  const accountId = aws.getCallerIdentityOutput().accountId;

  const snapshotBucket = new aws.s3.Bucket('DeviceSnapshots', {
    bucket: `${$app.name}-snapshots-${$app.stage}`,
    forceDestroy: $app.stage !== 'prod',
  });

  new aws.s3.BucketPublicAccessBlock('DeviceSnapshotsPublicAccessBlock', {
    bucket: snapshotBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });

  new aws.s3.BucketLifecycleConfiguration('DeviceSnapshotsLifecycle', {
    bucket: snapshotBucket.id,
    rules: [
      {
        id: 'abort-incomplete-uploads',
        status: 'Enabled',
        abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
        filter: {},
      },
    ],
  });

  const snapshotWriter = new sst.aws.Function('DeviceSnapshotWriter', {
    handler: 'packages/rest-api/src/homehub_api/iot/snapshot.handler',
    runtime: 'python3.13',
    memory: '512 MB',
    timeout: '30 seconds',
    link: [table],
    environment: {
      ...pythonLambdaEnv,
      TABLE_NAME: table.name,
      SNAPSHOT_BUCKET: snapshotBucket.bucket,
    },
    permissions: [
      {
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [table.arn],
      },
      {
        actions: ['s3:PutObject'],
        resources: [$interpolate`${snapshotBucket.arn}/snapshots/*`],
      },
    ],
  });

  const snapshotRule = new aws.iot.TopicRule('DeviceSnapshotRule', {
    name: `${$app.name}_${$app.stage}_device_snapshot`,
    enabled: true,
    sql: "SELECT topic(3) AS deviceId, * FROM 'homehub/devices/+/snapshot'",
    sqlVersion: '2016-03-23',
    lambdas: [{ functionArn: snapshotWriter.arn }],
  });

  new aws.lambda.Permission('DeviceSnapshotRulePermission', {
    action: 'lambda:InvokeFunction',
    function: snapshotWriter.arn,
    principal: 'iot.amazonaws.com',
    sourceArn: snapshotRule.arn,
  });

  const simulatorUser = new aws.iam.User('DeviceSimulatorUser', {
    name: `${$app.name}-${$app.stage}-device-simulator`,
    tags: { Project: $app.name, Stage: $app.stage },
  });

  const accessKey = new aws.iam.AccessKey('DeviceSimulatorAccessKey', {
    user: simulatorUser.name,
  });

  new aws.ssm.Parameter('DeviceSimulatorAccessKeyId', {
    name: `/homehub/${$app.stage}/simulator/access-key-id`,
    type: 'String',
    value: accessKey.id,
    overwrite: true,
  });

  new aws.ssm.Parameter('DeviceSimulatorSecretAccessKey', {
    name: `/homehub/${$app.stage}/simulator/secret-access-key`,
    type: 'SecureString',
    value: accessKey.secret,
    overwrite: true,
  });

  new aws.iam.UserPolicy('DeviceSimulatorUserPolicy', {
    user: simulatorUser.name,
    policy: pulumi
      .all([table.arn, iotProvisioning.simulatorQueue.arn, snapshotBucket.arn, accountId, region])
      .apply(([tableArn, queueArn, bucketArn, acct, reg]) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
              Resource: queueArn,
            },
            {
              Effect: 'Allow',
              Action: ['dynamodb:GetItem', 'dynamodb:Query'],
              Resource: [tableArn, `${tableArn}/index/*`],
            },
            {
              Effect: 'Allow',
              Action: ['iot:Connect', 'iot:Publish', 'iot:Subscribe', 'iot:Receive'],
              Resource: '*',
            },
            {
              Effect: 'Allow',
              Action: ['ssm:GetParameter'],
              Resource: `arn:aws:ssm:${reg}:${acct}:parameter/homehub/devices/*`,
            },
            {
              Effect: 'Allow',
              Action: ['s3:PutObject'],
              Resource: `${bucketArn}/*`,
            },
          ],
        })
      ),
  });

  return { snapshotBucket, snapshotWriter, snapshotRule };
}
