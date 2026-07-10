/// <reference path="../../../.sst/platform/config.d.ts" />

const INPUT_LIMITS = {
  name: 100,
  type: 64,
  location: 100,
  configuration: 4096,
  command: 64,
};

export function addDeviceResolvers(
  api: ReturnType<typeof import('../api-setup').createApi>,
  dynamoDataSource: ReturnType<typeof import('../api-setup').createDataSource>,
  _tableName: string
) {
  api.addResolver('Query listMyDevices', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const limit = ctx.args.limit || 50;

        return {
          operation: 'Query',
          query: {
            expression: 'PK = :pk AND begins_with(SK, :sk)',
            expressionValues: util.dynamodb.toMapValues({
              ':pk': \`USER#\${userId}\`,
              ':sk': 'DEVICE#'
            })
          },
          limit,
          nextToken: ctx.args.nextToken
        };
      }

      export function response(ctx) {
        if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
        return {
          items: ctx.result.items || [],
          nextToken: ctx.result.nextToken || null
        };
      }
    `,
  });

  api.addResolver('Query getDevice', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const { deviceId } = ctx.args;

        if (!deviceId) {
          return util.error('deviceId is required', 'ValidationError');
        }

        return {
          operation: 'GetItem',
          key: util.dynamodb.toMapValues({
            PK: \`USER#\${userId}\`,
            SK: \`DEVICE#\${deviceId}\`
          })
        };
      }

      export function response(ctx) {
        if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
        if (!ctx.result) return util.error('Device not found', 'NotFound');
        return ctx.result;
      }
    `,
  });

  api.addResolver('Mutation createDevice', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const input = ctx.args.input || {};
        const name = input.name || '';
        const type = input.type || '';
        const location = input.location || '';
        const configuration = input.configuration || '';

        if (!name) {
          return util.error('name is required', 'ValidationError');
        }
        if (name.length > ${INPUT_LIMITS.name}) {
          return util.error('name must be at most ${INPUT_LIMITS.name} characters', 'ValidationError');
        }
        if (!type) {
          return util.error('type is required', 'ValidationError');
        }
        if (type.length > ${INPUT_LIMITS.type}) {
          return util.error('type must be at most ${INPUT_LIMITS.type} characters', 'ValidationError');
        }
        if (location.length > ${INPUT_LIMITS.location}) {
          return util.error('location must be at most ${INPUT_LIMITS.location} characters', 'ValidationError');
        }
        if (configuration.length > ${INPUT_LIMITS.configuration}) {
          return util.error('configuration must be at most ${INPUT_LIMITS.configuration} characters', 'ValidationError');
        }

        const deviceId = util.autoId();
        const timestamp = util.time.nowISO8601();

        return {
          operation: 'PutItem',
          key: util.dynamodb.toMapValues({
            PK: \`USER#\${userId}\`,
            SK: \`DEVICE#\${deviceId}\`
          }),
          attributeValues: util.dynamodb.toMapValues({
            deviceId: deviceId,
            userId: userId,
            name: name,
            type: type,
            location: location,
            configuration: configuration,
            status: 'UNKNOWN',
            createdAt: timestamp,
            updatedAt: timestamp,
            GSI1PK: \`USER#\${userId}\`,
            GSI1SK: \`DEVICE#\${timestamp}\`
          })
        };
      }

      export function response(ctx) {
        if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
        return ctx.result;
      }
    `,
  });

  api.addResolver('Mutation updateDevice', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const deviceId = ctx.args.deviceId;
        const input = ctx.args.input || {};

        if (!deviceId) {
          return util.error('deviceId is required', 'ValidationError');
        }

        const updateExpression = [];
        const expressionNames = {};
        const expressionValues = {};

        if (input.name !== undefined && input.name !== null) {
          if (!input.name) {
            return util.error('name cannot be empty', 'ValidationError');
          }
          if (input.name.length > ${INPUT_LIMITS.name}) {
            return util.error('name must be at most ${INPUT_LIMITS.name} characters', 'ValidationError');
          }
          updateExpression.push('#name = :name');
          expressionNames['#name'] = 'name';
          expressionValues[':name'] = input.name;
        }

        if (input.type !== undefined && input.type !== null) {
          if (input.type.length > ${INPUT_LIMITS.type}) {
            return util.error('type must be at most ${INPUT_LIMITS.type} characters', 'ValidationError');
          }
          updateExpression.push('#type = :type');
          expressionNames['#type'] = 'type';
          expressionValues[':type'] = input.type;
        }

        if (input.location !== undefined && input.location !== null) {
          if (input.location.length > ${INPUT_LIMITS.location}) {
            return util.error('location must be at most ${INPUT_LIMITS.location} characters', 'ValidationError');
          }
          updateExpression.push('#location = :location');
          expressionNames['#location'] = 'location';
          expressionValues[':location'] = input.location;
        }

        if (input.status !== undefined && input.status !== null) {
          updateExpression.push('#status = :status');
          expressionNames['#status'] = 'status';
          expressionValues[':status'] = input.status;
        }

        if (input.configuration !== undefined && input.configuration !== null) {
          if (input.configuration.length > ${INPUT_LIMITS.configuration}) {
            return util.error('configuration must be at most ${INPUT_LIMITS.configuration} characters', 'ValidationError');
          }
          updateExpression.push('#configuration = :configuration');
          expressionNames['#configuration'] = 'configuration';
          expressionValues[':configuration'] = input.configuration;
        }

        if (input.lastSeenAt !== undefined && input.lastSeenAt !== null) {
          updateExpression.push('#lastSeenAt = :lastSeenAt');
          expressionNames['#lastSeenAt'] = 'lastSeenAt';
          expressionValues[':lastSeenAt'] = input.lastSeenAt;
        }

        if (updateExpression.length === 0) {
          return util.error('No fields to update', 'ValidationError');
        }

        updateExpression.push('#updatedAt = :updatedAt');
        expressionNames['#updatedAt'] = 'updatedAt';
        expressionValues[':updatedAt'] = util.time.nowISO8601();

        return {
          operation: 'UpdateItem',
          key: util.dynamodb.toMapValues({
            PK: \`USER#\${userId}\`,
            SK: \`DEVICE#\${deviceId}\`
          }),
          update: {
            expression: 'SET ' + updateExpression.join(', '),
            expressionNames: expressionNames,
            expressionValues: util.dynamodb.toMapValues(expressionValues)
          },
          returnValues: 'ALL_NEW'
        };
      }

      export function response(ctx) {
        if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
        if (!ctx.result) return util.error('Device not found', 'NotFound');
        return ctx.result;
      }
    `,
  });

  api.addResolver('Mutation deleteDevice', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const { deviceId } = ctx.args;

        if (!deviceId) {
          return util.error('deviceId is required', 'ValidationError');
        }

        return {
          operation: 'DeleteItem',
          key: util.dynamodb.toMapValues({
            PK: \`USER#\${userId}\`,
            SK: \`DEVICE#\${deviceId}\`
          }),
          condition: {
            expression: 'attribute_exists(PK)'
          },
          returnValues: 'ALL_OLD'
        };
      }

      export function response(ctx) {
        if (ctx.error) {
          if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
            return util.error('Device not found', 'NotFound');
          }
          return util.error(ctx.error.message, ctx.error.type);
        }
        return true;
      }
    `,
  });

  api.addResolver('Query listDeviceReadings', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const { deviceId } = ctx.args;
        const limit = ctx.args.limit || 50;

        if (!deviceId) {
          return util.error('deviceId is required', 'ValidationError');
        }

        return {
          operation: 'Query',
          query: {
            expression: 'PK = :pk AND begins_with(SK, :sk)',
            expressionValues: util.dynamodb.toMapValues({
              ':pk': \`USER#\${userId}\`,
              ':sk': \`READING#\${deviceId}#\`
            })
          },
          scanIndexForward: false,
          limit,
          nextToken: ctx.args.nextToken
        };
      }

      export function response(ctx) {
        if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
        return {
          items: ctx.result.items || [],
          nextToken: ctx.result.nextToken || null
        };
      }
    `,
  });

  api.addResolver('Mutation createDeviceReading', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const { deviceId } = ctx.args;
        const input = ctx.args.input || {};

        if (!deviceId) {
          return util.error('deviceId is required', 'ValidationError');
        }

        const readingId = util.autoId();
        const timestamp = util.time.nowISO8601();
        const recordedAt = input.recordedAt || timestamp;

        const item = {
          readingId,
          deviceId,
          userId,
          recordedAt,
          createdAt: timestamp
        };

        if (input.temperature !== undefined && input.temperature !== null) {
          item.temperature = input.temperature;
        }
        if (input.humidity !== undefined && input.humidity !== null) {
          item.humidity = input.humidity;
        }
        if (input.motionDetected !== undefined && input.motionDetected !== null) {
          item.motionDetected = input.motionDetected;
        }
        if (input.cameraOnline !== undefined && input.cameraOnline !== null) {
          item.cameraOnline = input.cameraOnline;
        }

        return {
          operation: 'PutItem',
          key: util.dynamodb.toMapValues({
            PK: \`USER#\${userId}\`,
            SK: \`READING#\${deviceId}#\${recordedAt}#\${readingId}\`
          }),
          attributeValues: util.dynamodb.toMapValues(item)
        };
      }

      export function response(ctx) {
        if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
        return ctx.result;
      }
    `,
  });

  api.addResolver('Query listDeviceCommands', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const { deviceId } = ctx.args;
        const limit = ctx.args.limit || 50;

        if (!deviceId) {
          return util.error('deviceId is required', 'ValidationError');
        }

        return {
          operation: 'Query',
          query: {
            expression: 'PK = :pk AND begins_with(SK, :sk)',
            expressionValues: util.dynamodb.toMapValues({
              ':pk': \`USER#\${userId}\`,
              ':sk': \`COMMAND#\${deviceId}#\`
            })
          },
          scanIndexForward: false,
          limit,
          nextToken: ctx.args.nextToken
        };
      }

      export function response(ctx) {
        if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
        return {
          items: ctx.result.items || [],
          nextToken: ctx.result.nextToken || null
        };
      }
    `,
  });

  api.addResolver('Mutation sendCommand', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const { deviceId } = ctx.args;
        const input = ctx.args.input || {};
        const command = (input.command || '').trim();

        if (!deviceId) {
          return util.error('deviceId is required', 'ValidationError');
        }
        if (!command) {
          return util.error('command is required', 'ValidationError');
        }
        if (command.length > ${INPUT_LIMITS.command}) {
          return util.error('command must be at most ${INPUT_LIMITS.command} characters', 'ValidationError');
        }

        const commandId = util.autoId();
        const timestamp = util.time.nowISO8601();

        const item = {
          commandId,
          deviceId,
          userId,
          command,
          status: 'PENDING',
          createdAt: timestamp,
          updatedAt: timestamp
        };

        return {
          operation: 'PutItem',
          key: util.dynamodb.toMapValues({
            PK: \`USER#\${userId}\`,
            SK: \`COMMAND#\${deviceId}#\${timestamp}#\${commandId}\`
          }),
          attributeValues: util.dynamodb.toMapValues(item)
        };
      }

      export function response(ctx) {
        if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
        return ctx.result;
      }
    `,
  });
}
