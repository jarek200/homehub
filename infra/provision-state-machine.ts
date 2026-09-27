import * as pulumi from '@pulumi/pulumi';

const ALREADY_EXISTS = [
  'Iot.ResourceAlreadyExistsException',
  'IoT.ResourceAlreadyExistsException',
  'ResourceAlreadyExistsException',
];

const FAIL_CAUSE =
  "{% $substring($exists($states.errorOutput.Cause) and $string($states.errorOutput.Cause) != '' ? $string($states.errorOutput.Cause) : ($exists($states.errorOutput.Error) ? $string($states.errorOutput.Error) : 'Provisioning failed'), 0, 500) %}";

const REGISTRY_ITEM =
  "{% ($item := { 'PK': { 'S': 'DEVICE_REGISTRY' }, 'SK': { 'S': 'DEVICE#' & $deviceId }, 'deviceId': { 'S': $deviceId }, 'thingName': { 'S': $thingName }, 'enabled': { 'Bool': false }, 'runtimeKind': { 'S': $runtimeKind }, 'status': { 'S': 'READY' }, 'tenantPk': { 'S': $tenantPk }, 'hubId': { 'S': $hubId }, 'ssmCertPrefix': { 'S': $ssmCertPrefix }, 'updatedAt': { 'S': $states.context.State.EnteredTime } }; $exists($certificateId) and $certificateId != '' ? $merge([$item, { 'certificateId': { 'S': $certificateId } }]) : $item) %}";

function catchFail(next = 'HasDeviceToFail') {
  return [{ ErrorEquals: ['States.ALL'], Assign: { failureCause: FAIL_CAUSE }, Next: next }];
}

export const PROVISION_START_AT = 'NormalizeInput';

export const PROVISION_STATE_NAMES = [
  'NormalizeInput',
  'ParseInput',
  'DeriveContext',
  'HasDeviceId',
  'SkipEmptyDevice',
  'CreateThing',
  'CreateCert',
  'AttachThingPrincipal',
  'WriteRegistry',
  'HasCertificateId',
  'MarkReadyWithCert',
  'MarkReady',
  'Provisioned',
  'HasDeviceToFail',
  'SkipMarkFailed',
  'HasCertificateToRollback',
  'DeactivateCert',
  'DeleteCert',
  'DeleteSsmCert',
  'DeleteSsmKey',
  'DeleteSsmCa',
  'MarkFailed',
] as const;

export function buildProvisionDefinition(input: {
  createCertFunctionArn: string;
  tableName: string;
}): Record<string, unknown> {
  const { createCertFunctionArn, tableName } = input;

  return {
    Comment: 'Provision HomeHub IoT device with per-device certificate',
    QueryLanguage: 'JSONata',
    StartAt: PROVISION_START_AT,
    States: {
      NormalizeInput: {
        Type: 'Pass',
        Assign: {
          record: "{% $type($states.input) = 'array' ? $states.input[0] : $states.input %}",
        },
        Next: 'ParseInput',
      },
      ParseInput: {
        Type: 'Pass',
        Assign: {
          tenantPk:
            "{% $exists($record.dynamodb.NewImage.PK.S) and $record.dynamodb.NewImage.PK.S != '' ? $record.dynamodb.NewImage.PK.S : 'HOUSEHOLD#demo' %}",
          deviceId:
            "{% $exists($record.dynamodb.NewImage.deviceId.S) and $record.dynamodb.NewImage.deviceId.S != '' ? $record.dynamodb.NewImage.deviceId.S : ($exists($record.dynamodb.Keys.SK.S) and $substring($record.dynamodb.Keys.SK.S, 0, 7) = 'DEVICE#' ? $substring($record.dynamodb.Keys.SK.S, 7) : '') %}",
          name: "{% $exists($record.dynamodb.NewImage.name.S) ? $record.dynamodb.NewImage.name.S : '' %}",
          deviceType:
            "{% $exists($record.dynamodb.NewImage.type.S) ? $record.dynamodb.NewImage.type.S : '' %}",
          runtimeKind:
            "{% $exists($record.dynamodb.NewImage.runtimeKind.S) and $record.dynamodb.NewImage.runtimeKind.S != '' ? $record.dynamodb.NewImage.runtimeKind.S : 'physical' %}",
          configuration:
            '{% $exists($record.dynamodb.NewImage.configuration.S) ? $record.dynamodb.NewImage.configuration.S : null %}',
          certificateArn: '',
          certificateId: '',
          failureCause: '',
        },
        Next: 'DeriveContext',
      },
      DeriveContext: {
        Type: 'Pass',
        Assign: {
          thingName: "{% $deviceId != '' ? 'homehub-' & $deviceId : '' %}",
          ssmCertPrefix: "{% $deviceId != '' ? '/homehub/devices/' & $deviceId : '' %}",
          hubId: "{% $replace($tenantPk, 'HOUSEHOLD#', '') %}",
        },
        Next: 'HasDeviceId',
      },
      HasDeviceId: {
        Type: 'Choice',
        Choices: [
          {
            Condition: "{% $deviceId = '' %}",
            Next: 'SkipEmptyDevice',
          },
        ],
        Default: 'CreateThing',
      },
      SkipEmptyDevice: {
        Type: 'Succeed',
      },
      CreateThing: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:iot:createThing',
        Arguments: {
          ThingName: '{% $thingName %}',
          AttributePayload: {
            Attributes: {
              deviceId: '{% $deviceId %}',
            },
          },
        },
        Next: 'CreateCert',
        Catch: [{ ErrorEquals: ALREADY_EXISTS, Next: 'CreateCert' }, ...catchFail()],
      },
      CreateCert: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Arguments: {
          FunctionName: createCertFunctionArn,
          Payload: {
            tenantPk: '{% $tenantPk %}',
            deviceId: '{% $deviceId %}',
            name: '{% $name %}',
            type: '{% $deviceType %}',
            runtimeKind: '{% $runtimeKind %}',
            configuration: '{% $configuration %}',
            thingName: '{% $thingName %}',
            ssmCertPrefix: '{% $ssmCertPrefix %}',
          },
        },
        Assign: {
          certificateArn: '{% $states.result.Payload.certificateArn %}',
          certificateId: '{% $states.result.Payload.certificateId %}',
          ssmCertPrefix:
            "{% $exists($states.result.Payload.ssmCertPrefix) and $states.result.Payload.ssmCertPrefix != '' ? $states.result.Payload.ssmCertPrefix : $ssmCertPrefix %}",
        },
        Next: 'AttachThingPrincipal',
        Catch: catchFail(),
      },
      AttachThingPrincipal: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:iot:attachThingPrincipal',
        Arguments: {
          ThingName: '{% $thingName %}',
          Principal: '{% $certificateArn %}',
        },
        Next: 'WriteRegistry',
        Catch: [{ ErrorEquals: ALREADY_EXISTS, Next: 'WriteRegistry' }, ...catchFail()],
      },
      WriteRegistry: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:dynamodb:putItem',
        Arguments: {
          TableName: tableName,
          Item: REGISTRY_ITEM,
        },
        Next: 'HasCertificateId',
        Catch: catchFail(),
      },
      HasCertificateId: {
        Type: 'Choice',
        Choices: [
          {
            Condition: "{% $exists($certificateId) and $certificateId != '' %}",
            Next: 'MarkReadyWithCert',
          },
        ],
        Default: 'MarkReady',
      },
      MarkReadyWithCert: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
        Arguments: {
          TableName: tableName,
          Key: {
            PK: { S: '{% $tenantPk %}' },
            SK: { S: "{% 'DEVICE#' & $deviceId %}" },
          },
          UpdateExpression:
            'SET lifecycleStatus = :ready, thingName = :thing, certificateId = :certId, updatedAt = :updatedAt REMOVE failureReason',
          ExpressionAttributeValues: {
            ':ready': { S: 'READY' },
            ':thing': { S: '{% $thingName %}' },
            ':certId': { S: '{% $certificateId %}' },
            ':updatedAt': { S: '{% $states.context.State.EnteredTime %}' },
          },
        },
        Next: 'Provisioned',
        Catch: catchFail(),
      },
      MarkReady: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
        Arguments: {
          TableName: tableName,
          Key: {
            PK: { S: '{% $tenantPk %}' },
            SK: { S: "{% 'DEVICE#' & $deviceId %}" },
          },
          UpdateExpression:
            'SET lifecycleStatus = :ready, thingName = :thing, updatedAt = :updatedAt REMOVE failureReason',
          ExpressionAttributeValues: {
            ':ready': { S: 'READY' },
            ':thing': { S: '{% $thingName %}' },
            ':updatedAt': { S: '{% $states.context.State.EnteredTime %}' },
          },
        },
        Next: 'Provisioned',
        Catch: catchFail(),
      },
      Provisioned: {
        Type: 'Succeed',
      },
      HasDeviceToFail: {
        Type: 'Choice',
        Choices: [
          {
            Condition: "{% $deviceId = '' %}",
            Next: 'SkipMarkFailed',
          },
        ],
        Default: 'HasCertificateToRollback',
      },
      SkipMarkFailed: {
        Type: 'Succeed',
      },
      HasCertificateToRollback: {
        Type: 'Choice',
        Choices: [
          {
            Condition: "{% $exists($certificateId) and $certificateId != '' %}",
            Next: 'DeactivateCert',
          },
        ],
        Default: 'DeleteSsmCert',
      },
      DeactivateCert: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:iot:updateCertificate',
        Arguments: {
          CertificateId: '{% $certificateId %}',
          NewStatus: 'INACTIVE',
        },
        Next: 'DeleteCert',
        Catch: [{ ErrorEquals: ['States.ALL'], Next: 'DeleteCert' }],
      },
      DeleteCert: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:iot:deleteCertificate',
        Arguments: {
          CertificateId: '{% $certificateId %}',
          ForceDelete: true,
        },
        Next: 'DeleteSsmCert',
        Catch: [{ ErrorEquals: ['States.ALL'], Next: 'DeleteSsmCert' }],
      },
      DeleteSsmCert: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:ssm:deleteParameter',
        Arguments: {
          Name: "{% $ssmCertPrefix & '/cert' %}",
        },
        Next: 'DeleteSsmKey',
        Catch: [{ ErrorEquals: ['States.ALL'], Next: 'DeleteSsmKey' }],
      },
      DeleteSsmKey: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:ssm:deleteParameter',
        Arguments: {
          Name: "{% $ssmCertPrefix & '/key' %}",
        },
        Next: 'DeleteSsmCa',
        Catch: [{ ErrorEquals: ['States.ALL'], Next: 'DeleteSsmCa' }],
      },
      DeleteSsmCa: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:ssm:deleteParameter',
        Arguments: {
          Name: "{% $ssmCertPrefix & '/ca' %}",
        },
        Next: 'MarkFailed',
        Catch: [{ ErrorEquals: ['States.ALL'], Next: 'MarkFailed' }],
      },
      MarkFailed: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
        Arguments: {
          TableName: tableName,
          Key: {
            PK: { S: '{% $tenantPk %}' },
            SK: { S: "{% 'DEVICE#' & $deviceId %}" },
          },
          UpdateExpression:
            'SET lifecycleStatus = :failed, failureReason = :reason, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':failed': { S: 'FAILED' },
            ':reason': {
              S: "{% $exists($failureCause) and $failureCause != '' ? $failureCause : 'Provisioning failed' %}",
            },
            ':updatedAt': { S: '{% $states.context.State.EnteredTime %}' },
          },
        },
        End: true,
      },
    },
  };
}

export function provisionStateMachineDefinition(
  createCertFunctionArn: pulumi.Input<string>,
  tableName: pulumi.Input<string>
): pulumi.Output<string> {
  return pulumi.all([createCertFunctionArn, tableName]).apply(([certArn, table]) =>
    JSON.stringify(
      buildProvisionDefinition({
        createCertFunctionArn: certArn,
        tableName: table,
      })
    )
  );
}
