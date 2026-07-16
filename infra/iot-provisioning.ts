/// <reference path="../../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { pythonLambdaEnv } from './python-lambda';
import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];

const SFN_HANDLER = 'packages/rest-api/src/homehub_api/iot/sfn';

function createProvisionTask(
  name: string,
  handler: string,
  table: StorageTable,
  simulatorQueue: sst.aws.Queue,
  extraEnv: Record<string, pulumi.Input<string>> = {},
  extraPermissions: Array<{ actions: string[]; resources: pulumi.Input<string>[] }> = []
) {
  return new sst.aws.Function(name, {
    handler,
    runtime: 'python3.13',
    memory: stageConfig.lambda.memory,
    timeout: '120 seconds',
    // Provisioning is triggered by DynamoDB → Pipe → Step Functions. Live/dev
    // mode often hangs these invocations (CreateCert/Finalize timeout at 120s).
    // Run them in AWS so device create works even when the Live bridge is flaky.
    dev: false,
    link: [table, simulatorQueue],
    environment: {
      ...pythonLambdaEnv,
      TABLE_NAME: table.name,
      SIMULATOR_QUEUE_URL: simulatorQueue.url,
      ...extraEnv,
    },
    permissions: [
      {
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
        resources: [table.arn, $interpolate`${table.arn}/index/*`],
      },
      {
        actions: ['sqs:SendMessage'],
        resources: [simulatorQueue.arn],
      },
      ...extraPermissions,
    ],
  });
}

export function createIotProvisioning(table: StorageTable) {
  const simulatorQueue = new sst.aws.Queue('SimulatorEvents', {
    visibilityTimeout: '2 minutes',
  });

  const iotPolicy = new aws.iot.Policy('SimulatorIotPolicy', {
    name: `${$app.name}-${$app.stage}-simulator`,
    policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['iot:Connect', 'iot:Publish', 'iot:Subscribe', 'iot:Receive'],
          Resource: ['*'],
        },
      ],
    }),
  });

  const iotEndpoint = aws.iot.getEndpointOutput({ endpointType: 'iot:Data-ATS' });
  const sharedEnv = {
    IOT_POLICY_NAME: iotPolicy.name,
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

  const parseFn = createProvisionTask(
    'SfnParseStream',
    `${SFN_HANDLER}/parse_stream.handler`,
    table,
    simulatorQueue,
    sharedEnv
  );

  const createCertFn = createProvisionTask(
    'SfnCreateCert',
    `${SFN_HANDLER}/create_cert.handler`,
    table,
    simulatorQueue,
    sharedEnv,
    iotCertPermissions
  );

  const createThingFn = createProvisionTask(
    'SfnCreateThing',
    `${SFN_HANDLER}/create_thing.handler`,
    table,
    simulatorQueue,
    sharedEnv,
    [
      {
        actions: ['iot:CreateThing', 'iot:AttachThingPrincipal', 'iot:UpdateThingShadow'],
        resources: ['*'],
      },
    ]
  );

  const finalizeFn = createProvisionTask(
    'SfnFinalize',
    `${SFN_HANDLER}/finalize.handler`,
    table,
    simulatorQueue,
    sharedEnv
  );

  const markFailedFn = createProvisionTask(
    'SfnMarkFailed',
    `${SFN_HANDLER}/mark_failed.handler`,
    table,
    simulatorQueue,
    sharedEnv,
    iotCertPermissions
  );

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

  const taskArns = pulumi.all([
    parseFn.arn,
    createCertFn.arn,
    createThingFn.arn,
    finalizeFn.arn,
    markFailedFn.arn,
  ]);

  new aws.iam.RolePolicy('ProvisionStateMachinePolicy', {
    role: sfnRole.id,
    policy: taskArns.apply(([parseArn, certArn, thingArn, finalizeArn, failedArn]) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'lambda:InvokeFunction',
            Resource: [parseArn, certArn, thingArn, finalizeArn, failedArn],
          },
        ],
      })
    ),
  });

  const stateMachineDefinition = taskArns.apply(
    ([parseArn, certArn, thingArn, finalizeArn, failedArn]) =>
      JSON.stringify({
        Comment: 'Provision HomeHub IoT device with per-device certificate',
        StartAt: 'NormalizeInput',
        States: {
          NormalizeInput: {
            Type: 'Pass',
            InputPath: '$[0]',
            Next: 'ParseInput',
          },
          ParseInput: {
            Type: 'Task',
            Resource: parseArn,
            Next: 'CreateCert',
            Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'MarkFailed' }],
          },
          CreateCert: {
            Type: 'Task',
            Resource: certArn,
            ResultPath: '$.cert',
            Next: 'CreateThing',
            Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'MarkFailed' }],
          },
          CreateThing: {
            Type: 'Task',
            Resource: thingArn,
            ResultPath: '$.thing',
            Next: 'Finalize',
            Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'MarkFailed' }],
          },
          Finalize: {
            Type: 'Task',
            Resource: finalizeArn,
            End: true,
            Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'MarkFailed' }],
          },
          MarkFailed: {
            Type: 'Task',
            Resource: failedArn,
            End: true,
          },
        },
      })
  );

  const stateMachine = new aws.sfn.StateMachine('DeviceProvisionStateMachine', {
    name: `${$app.name}-${$app.stage}-device-provision`,
    roleArn: sfnRole.arn,
    type: 'STANDARD',
    definition: stateMachineDefinition,
  });

  for (const [name, fn] of [
    ['Parse', parseFn],
    ['CreateCert', createCertFn],
    ['CreateThing', createThingFn],
    ['Finalize', finalizeFn],
    ['MarkFailed', markFailedFn],
  ] as const) {
    new aws.lambda.Permission(`SfnInvoke${name}`, {
      action: 'lambda:InvokeFunction',
      function: fn.arn,
      principal: 'states.amazonaws.com',
      sourceArn: stateMachine.arn,
    });
  }

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
    simulatorQueue,
    iotPolicy,
    iotEndpoint,
    stateMachine,
    pipe,
    parseFn,
    createCertFn,
    createThingFn,
    finalizeFn,
    markFailedFn,
  };
}
