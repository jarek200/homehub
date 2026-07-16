/// <reference path="../../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];
type IotProvisioning = ReturnType<typeof import('./iot-provisioning').createIotProvisioning>;

export function createDeviceSimulator(
  table: StorageTable,
  iotProvisioning: Pick<IotProvisioning, 'simulatorQueue' | 'iotEndpoint'>
) {
  if (!stageConfig.deviceSimulator.enabled) {
    return undefined;
  }

  const region = aws.getRegionOutput().name;
  const accountId = aws.getCallerIdentityOutput().accountId;
  const serviceName = `${$app.name}-${$app.stage}-simulator`.replace(/_/g, '-');

  const ecrRepository = new aws.ecr.Repository('DeviceSimulatorEcr', {
    name: `${$app.name}-device-simulator-${$app.stage}`,
    imageTagMutability: 'MUTABLE',
    imageScanningConfiguration: { scanOnPush: true },
    forceDelete: $app.stage !== 'prod',
  });

  const containerService = new aws.lightsail.ContainerService('DeviceSimulator', {
    name: serviceName,
    power: stageConfig.deviceSimulator.power,
    scale: stageConfig.deviceSimulator.scale,
    isDisabled: false,
    privateRegistryAccess: {
      ecrImagePullerRole: { isActive: true },
    },
    tags: {
      Project: $app.name,
      Stage: $app.stage,
    },
  });

  new aws.ecr.RepositoryPolicy('DeviceSimulatorEcrPolicy', {
    repository: ecrRepository.name,
    policy: containerService.privateRegistryAccess.apply((access) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowLightsailPull',
            Effect: 'Allow',
            Principal: { AWS: access.ecrImagePullerRole.principalArn },
            Action: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
          },
        ],
      })
    ),
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
      .all([table.arn, iotProvisioning.simulatorQueue.arn, accountId, region])
      .apply(([tableArn, queueArn, acct, reg]) =>
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
          ],
        })
      ),
  });

  const imageUri = pulumi.interpolate`${accountId}.dkr.ecr.${region}.amazonaws.com/${ecrRepository.name}:latest`;

  return {
    ecrRepository,
    containerService,
    imageUri,
    serviceName: containerService.name,
  };
}
