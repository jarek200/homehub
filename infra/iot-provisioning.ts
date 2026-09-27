/// <reference path="../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { provisionStateMachineDefinition } from './provision-state-machine';
import { pythonLambdaEnv } from './python-lambda';
import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];

type CameraAccess = Pick<
  ReturnType<typeof import('./device-runtime').createSnapshotStorage>,
  'cameraIotPolicy'
>;

function createDeviceConnectPolicy(resourceName: string, policyName: string) {
  return new aws.iot.Policy(resourceName, {
    name: policyName,
    policy: pulumi
      .all([aws.getRegionOutput().name, aws.getCallerIdentityOutput().accountId])
      .apply(([region, accountId]) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'iot:Connect',
              Resource: `arn:aws:iot:${region}:${accountId}:client/\${iot:Connection.Thing.ThingName}`,
            },
            {
              Effect: 'Allow',
              Action: 'iot:Publish',
              Resource: [
                `arn:aws:iot:${region}:${accountId}:topic/homehub/${$app.stage}/devices/\${iot:Connection.Thing.Attributes[deviceId]}/telemetry`,
                `arn:aws:iot:${region}:${accountId}:topic/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/get`,
                `arn:aws:iot:${region}:${accountId}:topic/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/update`,
              ],
            },
            {
              Effect: 'Allow',
              Action: 'iot:Subscribe',
              Resource: [
                `arn:aws:iot:${region}:${accountId}:topicfilter/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/get/accepted`,
                `arn:aws:iot:${region}:${accountId}:topicfilter/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/update/accepted`,
                `arn:aws:iot:${region}:${accountId}:topicfilter/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/update/delta`,
              ],
            },
            {
              Effect: 'Allow',
              Action: 'iot:Receive',
              Resource: [
                `arn:aws:iot:${region}:${accountId}:topic/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/get/accepted`,
                `arn:aws:iot:${region}:${accountId}:topic/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/update/accepted`,
                `arn:aws:iot:${region}:${accountId}:topic/$aws/things/\${iot:Connection.Thing.ThingName}/shadow/update/delta`,
              ],
            },
          ],
        })
      ),
  });
}

export function createIotProvisioning(table: StorageTable, cameraAccess?: CameraAccess) {
  const iotPolicy = createDeviceConnectPolicy(
    'DeviceIotPolicy',
    `${$app.name}-${$app.stage}-device`
  );
  // Prod certificates are still attached to the previous policy. IoT will not
  // delete an attached policy, so keep it until migrate-iot-policy.sh prod runs.
  const legacyIotPolicy =
    $app.stage === 'prod'
      ? createDeviceConnectPolicy('SimulatorIotPolicy', `${$app.name}-${$app.stage}-simulator`)
      : undefined;

  const gatewayIotPolicy = new aws.iot.Policy('GatewayIotPolicy', {
    name: `${$app.name}-${$app.stage}-gateway`,
    policy: pulumi
      .all([aws.getRegionOutput().name, aws.getCallerIdentityOutput().accountId])
      .apply(([region, accountId]) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'iot:Connect',
              Resource: `arn:aws:iot:${region}:${accountId}:client/\${iot:Connection.Thing.ThingName}`,
            },
            {
              Effect: 'Allow',
              Action: 'iot:Publish',
              Resource: `arn:aws:iot:${region}:${accountId}:topic/homehub/gateways/\${iot:Connection.Thing.Attributes[deviceId]}/*`,
            },
            {
              Effect: 'Allow',
              Action: 'iot:Subscribe',
              Resource: `arn:aws:iot:${region}:${accountId}:topicfilter/homehub/gateways/\${iot:Connection.Thing.Attributes[deviceId]}/*`,
            },
            {
              Effect: 'Allow',
              Action: 'iot:Receive',
              Resource: `arn:aws:iot:${region}:${accountId}:topic/homehub/gateways/\${iot:Connection.Thing.Attributes[deviceId]}/*`,
            },
          ],
        })
      ),
  });

  const iotEndpoint = aws.iot.getEndpointOutput({ endpointType: 'iot:Data-ATS' });
  const sharedEnv = {
    IOT_POLICY_NAME: iotPolicy.name,
    GATEWAY_IOT_POLICY_NAME: gatewayIotPolicy.name,
    CAMERA_IOT_POLICY_NAME: cameraAccess?.cameraIotPolicy.name ?? '',
    IOT_DATA_ENDPOINT: iotEndpoint.endpointAddress.apply((host) => `https://${host}`),
  };

  const iotCertPermissions = [
    {
      actions: [
        'iot:CreateKeysAndCertificate',
        'iot:AttachPolicy',
        'iot:CreateThing',
        'iot:AttachThingPrincipal',
        'iot:UpdateCertificate',
        'iot:DeleteCertificate',
        'iot:DescribeCertificate',
        'iot:DetachPolicy',
        'iot:DetachThingPrincipal',
        'iot:DeleteThing',
        'iot:UpdateThingShadow',
      ],
      resources: ['*'],
    },
    {
      actions: ['ssm:PutParameter', 'ssm:DeleteParameter', 'ssm:GetParameter'],
      resources: [
        pulumi.interpolate`arn:aws:ssm:${aws.getRegionOutput().name}:${aws.getCallerIdentityOutput().accountId}:parameter/homehub/devices/*`,
      ],
    },
  ];

  const createCertFn = new sst.aws.Function('SfnCreateCert', {
    handler: 'services/api/src/homehub_api/iot/sfn/create_cert.handler',
    runtime: 'python3.13',
    memory: stageConfig.lambda.memory,
    timeout: '120 seconds',
    // Provisioning is triggered by DynamoDB → Pipe → Step Functions. Live/dev
    // mode often hangs these invocations (CreateCert timeout at 120s).
    // Run them in AWS so device create works even when the Live bridge is flaky.
    dev: false,
    environment: {
      ...pythonLambdaEnv,
      ...sharedEnv,
    },
    permissions: iotCertPermissions,
  });

  const sfnRole = new aws.iam.Role('ProvisionStateMachineRole', {
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'states.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    }),
  });

  const ssmParameterArn = pulumi.interpolate`arn:aws:ssm:${aws.getRegionOutput().name}:${aws.getCallerIdentityOutput().accountId}:parameter/homehub/devices/*`;

  new aws.iam.RolePolicy('ProvisionStateMachinePolicy', {
    role: sfnRole.id,
    policy: pulumi
      .all([createCertFn.arn, table.arn, ssmParameterArn])
      .apply(([certArn, tableArn, ssmArn]) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'lambda:InvokeFunction',
              Resource: [certArn, `${certArn}:*`],
            },
            {
              Effect: 'Allow',
              Action: [
                'iot:CreateThing',
                'iot:AttachThingPrincipal',
                'iot:UpdateCertificate',
                'iot:DeleteCertificate',
              ],
              Resource: ['*'],
            },
            {
              Effect: 'Allow',
              Action: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
              Resource: [tableArn, `${tableArn}/index/*`],
            },
            {
              Effect: 'Allow',
              Action: ['ssm:DeleteParameter'],
              Resource: [ssmArn],
            },
          ],
        })
      ),
  });

  const stateMachine = new aws.sfn.StateMachine('DeviceProvisionStateMachine', {
    name: `${$app.name}-${$app.stage}-device-provision`,
    roleArn: sfnRole.arn,
    type: 'STANDARD',
    definition: provisionStateMachineDefinition(createCertFn.arn, table.name),
  });

  new aws.lambda.Permission('SfnInvokeCreateCert', {
    action: 'lambda:InvokeFunction',
    function: createCertFn.arn,
    principal: 'states.amazonaws.com',
    sourceArn: stateMachine.arn,
  });

  const streamArn = table.nodes.table.apply((t) => t.streamArn);
  const accountId = aws.getCallerIdentityOutput().accountId;
  const region = aws.getRegionOutput().name;

  const pipeRole = new aws.iam.Role('DeviceProvisionPipeRole', {
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'pipes.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    }),
  });

  new aws.iam.RolePolicy('DeviceProvisionPipePolicy', {
    role: pipeRole.id,
    policy: pulumi
      .all([streamArn, stateMachine.arn, accountId, region])
      .apply(([stream, sfnArn, acct, reg]) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'dynamodb:DescribeStream',
                'dynamodb:GetRecords',
                'dynamodb:GetShardIterator',
                'dynamodb:ListStreams',
              ],
              Resource: [stream],
            },
            {
              Effect: 'Allow',
              Action: ['states:StartExecution'],
              Resource: [sfnArn],
            },
            {
              Effect: 'Allow',
              Action: ['sqs:SendMessage'],
              Resource: [`arn:aws:sqs:${reg}:${acct}:*`],
            },
          ],
        })
      ),
  });

  const pipe = new aws.pipes.Pipe('DeviceProvisionPipe', {
    name: `${$app.name}-${$app.stage}-device-provision`,
    roleArn: pipeRole.arn,
    source: streamArn,
    target: stateMachine.arn,
    sourceParameters: {
      dynamodbStreamParameters: {
        startingPosition: 'LATEST',
        batchSize: 1,
      },
      filterCriteria: {
        filters: [
          {
            pattern: JSON.stringify({
              eventName: ['INSERT'],
              dynamodb: {
                Keys: {
                  SK: { S: [{ prefix: 'DEVICE#' }] },
                },
                NewImage: {
                  lifecycleStatus: { S: ['PROVISIONING'] },
                },
              },
            }),
          },
        ],
      },
    },
    targetParameters: {
      stepFunctionStateMachineParameters: {
        invocationType: 'FIRE_AND_FORGET',
      },
    },
  });

  return {
    iotPolicy,
    legacyIotPolicy,
    gatewayIotPolicy,
    cameraIotPolicy: cameraAccess?.cameraIotPolicy,
    iotEndpoint,
    stateMachine,
    pipe,
    createCertFn,
  };
}
