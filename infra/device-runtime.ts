/// <reference path="../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export type SnapshotStorage = ReturnType<typeof createSnapshotStorage>;

/**
 * Private JPEG bucket plus IoT Role Alias so cameras can SigV4 PUT without
 * long-lived AWS keys. Created before IoT provisioning so CreateCert can attach
 * CameraIotPolicy.
 */
export function createSnapshotStorage() {
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

  new aws.s3.BucketPolicy('DeviceSnapshotsTlsPolicy', {
    bucket: snapshotBucket.id,
    policy: snapshotBucket.arn.apply((bucketArn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'DenyInsecureTransport',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:*',
            Resource: [bucketArn, `${bucketArn}/*`],
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          },
        ],
      })
    ),
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
      {
        id: 'expire-snapshots',
        status: 'Enabled',
        expiration: { days: 90 },
        filter: { prefix: 'snapshots/' },
      },
    ],
  });

  const cameraS3Role = new aws.iam.Role('CameraSnapshotRole', {
    name: `${$app.name}-${$app.stage}-camera-s3`,
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'credentials.iot.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    }),
    tags: { Project: $app.name, Stage: $app.stage },
  });

  new aws.iam.RolePolicy('CameraSnapshotPut', {
    role: cameraS3Role.id,
    policy: pulumi.interpolate`{
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Action": ["s3:PutObject"],
          "Resource": "${snapshotBucket.arn}/snapshots/\${credentials-iot:ThingName}/*"
        }
      ]
    }`,
  });

  const cameraRoleAlias = new aws.iot.RoleAlias('CameraS3RoleAlias', {
    alias: `${$app.name}-${$app.stage}-camera-s3`,
    roleArn: cameraS3Role.arn,
    credentialDurationSeconds: 3600,
  });

  const cameraIotPolicy = new aws.iot.Policy('CameraIotPolicy', {
    name: `${$app.name}-${$app.stage}-camera`,
    policy: pulumi
      .all([region, accountId, cameraRoleAlias.arn])
      .apply(([reg, acct, roleAliasArn]) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'iot:Connect',
              Resource: `arn:aws:iot:${reg}:${acct}:client/\${iot:Connection.Thing.ThingName}`,
            },
            {
              Effect: 'Allow',
              Action: 'iot:Publish',
              Resource: [
                `arn:aws:iot:${reg}:${acct}:topic/homehub/${$app.stage}/devices/\${iot:Connection.Thing.Attributes[deviceId]}/telemetry`,
                `arn:aws:iot:${reg}:${acct}:topic/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/get`,
                `arn:aws:iot:${reg}:${acct}:topic/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/update`,
              ],
            },
            {
              Effect: 'Allow',
              Action: 'iot:Subscribe',
              Resource: [
                `arn:aws:iot:${reg}:${acct}:topicfilter/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/get/accepted`,
                `arn:aws:iot:${reg}:${acct}:topicfilter/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/update/accepted`,
                `arn:aws:iot:${reg}:${acct}:topicfilter/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/update/delta`,
              ],
            },
            {
              Effect: 'Allow',
              Action: 'iot:Receive',
              Resource: [
                `arn:aws:iot:${reg}:${acct}:topic/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/get/accepted`,
                `arn:aws:iot:${reg}:${acct}:topic/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/update/accepted`,
                `arn:aws:iot:${reg}:${acct}:topic/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/update/delta`,
              ],
            },
            {
              Effect: 'Allow',
              Action: 'iot:AssumeRoleWithCertificate',
              Resource: roleAliasArn,
            },
          ],
        })
      ),
  });

  const credentialsEndpoint = aws.iot.getEndpointOutput({
    endpointType: 'iot:CredentialProvider',
  });

  return {
    snapshotBucket,
    cameraS3Role,
    cameraRoleAlias,
    cameraIotPolicy,
    credentialsEndpoint,
  };
}
