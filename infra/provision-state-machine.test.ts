import { describe, expect, it } from 'vitest';
import {
  firstPipeRecord,
  hubIdFromPk,
  parseProvisionContext,
  shadowUpdatePayload,
  truncateFailureCause,
} from './provision-context';
import {
  buildProvisionDefinition,
  PROVISION_START_AT,
  PROVISION_STATE_NAMES,
} from './provision-state-machine';

const streamRecord = {
  eventName: 'INSERT',
  dynamodb: {
    Keys: { PK: { S: 'HOUSEHOLD#demo' }, SK: { S: 'DEVICE#dev1' } },
    NewImage: {
      PK: { S: 'HOUSEHOLD#demo' },
      SK: { S: 'DEVICE#dev1' },
      deviceId: { S: 'dev1' },
      name: { S: 'Hallway' },
      type: { S: 'environmental-sensor' },
      lifecycleStatus: { S: 'PROVISIONING' },
      configuration: { S: '{"reportingIntervalSeconds":10}' },
    },
  },
};

describe('provision context parity', () => {
  it('parses a Pipe batch the same way as parse_stream_record', () => {
    const parsed = parseProvisionContext([streamRecord]);
    expect(parsed).toMatchObject({
      tenantPk: 'HOUSEHOLD#demo',
      deviceId: 'dev1',
      type: 'environmental-sensor',
      runtimeKind: 'physical',
      thingName: 'homehub-dev1',
      ssmCertPrefix: '/homehub/devices/dev1',
      hubId: 'demo',
      configuration: '{"reportingIntervalSeconds":10}',
    });
    expect(firstPipeRecord([streamRecord])).toEqual(streamRecord);
  });

  it('preserves physical runtime and user household', () => {
    const parsed = parseProvisionContext({
      eventName: 'INSERT',
      dynamodb: {
        Keys: { SK: { S: 'DEVICE#fb1' } },
        NewImage: {
          PK: { S: 'HOUSEHOLD#user-abc' },
          deviceId: { S: 'fb1' },
          runtimeKind: { S: 'physical' },
          type: { S: 'environmental-sensor' },
        },
      },
    });
    expect(parsed?.runtimeKind).toBe('physical');
    expect(parsed?.hubId).toBe('user-abc');
  });

  it('returns null when deviceId cannot be derived', () => {
    expect(parseProvisionContext({ dynamodb: { NewImage: {} } })).toBeNull();
  });

  it('strips the HOUSEHOLD# prefix', () => {
    expect(hubIdFromPk('HOUSEHOLD#demo')).toBe('demo');
    expect(hubIdFromPk('plain')).toBe('plain');
  });

  it('builds the UpdateThingShadow body that matches shadow_update_payload', () => {
    expect(shadowUpdatePayload(null, 'camera')).toEqual({ state: { desired: { type: 'camera' } } });
    expect(shadowUpdatePayload('', 'camera')).toEqual({ state: { desired: { type: 'camera' } } });
    expect(shadowUpdatePayload('{}', 'environmental-sensor')).toEqual({
      state: { desired: { type: 'environmental-sensor' } },
    });
    expect(shadowUpdatePayload('not-json', 'camera')).toEqual({
      state: { desired: { type: 'camera' } },
    });
    expect(shadowUpdatePayload('{"reportingIntervalSeconds":10}', 'camera')).toEqual({
      state: {
        desired: {
          type: 'camera',
          configuration: { reportingIntervalSeconds: 10 },
        },
      },
    });
  });

  it('truncates failure causes to 500 characters', () => {
    expect(truncateFailureCause(undefined)).toBe('Provisioning failed');
    expect(truncateFailureCause('x'.repeat(501)).length).toBe(500);
  });
});

describe('provision state machine definition', () => {
  const definition = buildProvisionDefinition({
    createCertFunctionArn: 'arn:aws:lambda:eu-west-1:1:function:CreateCert',
    tableName: 'homehub-int-table',
  });

  it('is a JSONata workflow that keeps only the CreateCert Lambda', () => {
    expect(definition.QueryLanguage).toBe('JSONata');
    expect(definition.StartAt).toBe(PROVISION_START_AT);
    const states = definition.States as Record<string, { Resource?: string }>;
    expect(Object.keys(states)).toEqual([...PROVISION_STATE_NAMES]);
    const lambdaTasks = Object.values(states).filter((state) =>
      state.Resource?.includes('lambda:invoke')
    );
    expect(lambdaTasks).toHaveLength(1);
    expect(states.CreateThing.Resource).toBe('arn:aws:states:::aws-sdk:iot:createThing');
    expect(states.CreateCert.Resource).toBe('arn:aws:states:::lambda:invoke');
    expect(Object.keys(states).indexOf('CreateThing')).toBeLessThan(
      Object.keys(states).indexOf('CreateCert')
    );
    expect(JSON.stringify(definition)).not.toContain('updateThingShadow');
    expect(JSON.stringify(definition)).toContain("'Bool'");
    expect(JSON.stringify(definition)).not.toContain("'BOOL'");
    expect(JSON.stringify(definition)).toContain("$replace($tenantPk, 'HOUSEHOLD#', '')");
    expect(JSON.stringify(definition)).toContain('$deviceType');
    expect(JSON.stringify(definition)).toContain('$states.errorOutput');
    expect(JSON.stringify(definition)).not.toContain('$states.error.');
    expect(states.WriteRegistry.Resource).toBe('arn:aws:states:::aws-sdk:dynamodb:putItem');
    expect(JSON.stringify(definition)).not.toContain('sqs:sendMessage');
    expect(states.MarkFailed.Resource).toBe('arn:aws:states:::aws-sdk:dynamodb:updateItem');
  });
});
