/// <reference path="../../../.sst/platform/config.d.ts" />

const INPUT_LIMITS = {
  title: 200,
  notes: 2000,
};

export function addIssueResolvers(
  api: ReturnType<typeof import('../api-setup').createApi>,
  dynamoDataSource: ReturnType<typeof import('../api-setup').createDataSource>,
  _tableName: string
) {
  api.addResolver('Query listMyIssues', {
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
              ':sk': 'ISSUE#'
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

  api.addResolver('Query getIssue', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const { issueId } = ctx.args;

        if (!issueId) {
          return util.error('issueId is required', 'ValidationError');
        }

        return {
          operation: 'GetItem',
          key: util.dynamodb.toMapValues({
            PK: \`USER#\${userId}\`,
            SK: \`ISSUE#\${issueId}\`
          })
        };
      }

      export function response(ctx) {
        if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
        if (!ctx.result) return util.error('Issue not found', 'NotFound');
        return ctx.result;
      }
    `,
  });

  api.addResolver('Mutation createIssue', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const input = ctx.args.input || {};
        const title = (input.title || '').trim();

        if (!title) {
          return util.error('title is required', 'ValidationError');
        }
        if (title.length > ${INPUT_LIMITS.title}) {
          return util.error('title must be at most ${INPUT_LIMITS.title} characters', 'ValidationError');
        }
        if (input.notes && input.notes.length > ${INPUT_LIMITS.notes}) {
          return util.error('notes must be at most ${INPUT_LIMITS.notes} characters', 'ValidationError');
        }

        const issueId = util.autoId();
        const timestamp = util.time.nowISO8601();

        return {
          operation: 'PutItem',
          key: util.dynamodb.toMapValues({
            PK: \`USER#\${userId}\`,
            SK: \`ISSUE#\${issueId}\`
          }),
          attributeValues: util.dynamodb.toMapValues({
            issueId,
            userId,
            title,
            deviceId: input.deviceId || null,
            severity: input.severity || 'MEDIUM',
            status: input.status || 'OPEN',
            notes: input.notes || null,
            createdAt: timestamp,
            updatedAt: timestamp,
            GSI1PK: \`USER#\${userId}\`,
            GSI1SK: \`ISSUE#\${timestamp}\`
          })
        };
      }

      export function response(ctx) {
        if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
        return ctx.result;
      }
    `,
  });

  api.addResolver('Mutation updateIssue', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';

      export function request(ctx) {
        const userId = ctx.identity.sub;
        const issueId = ctx.args.issueId;
        const input = ctx.args.input || {};

        if (!issueId) {
          return util.error('issueId is required', 'ValidationError');
        }

        const updateExpression = [];
        const expressionNames = {};
        const expressionValues = {};

        if (input.title !== undefined && input.title !== null) {
          if (!input.title.trim()) {
            return util.error('title cannot be empty', 'ValidationError');
          }
          if (input.title.length > ${INPUT_LIMITS.title}) {
            return util.error('title must be at most ${INPUT_LIMITS.title} characters', 'ValidationError');
          }
          updateExpression.push('#title = :title');
          expressionNames['#title'] = 'title';
          expressionValues[':title'] = input.title;
        }

        if (input.deviceId !== undefined && input.deviceId !== null) {
          updateExpression.push('#deviceId = :deviceId');
          expressionNames['#deviceId'] = 'deviceId';
          expressionValues[':deviceId'] = input.deviceId;
        }

        if (input.severity !== undefined && input.severity !== null) {
          updateExpression.push('#severity = :severity');
          expressionNames['#severity'] = 'severity';
          expressionValues[':severity'] = input.severity;
        }

        if (input.status !== undefined && input.status !== null) {
          updateExpression.push('#status = :status');
          expressionNames['#status'] = 'status';
          expressionValues[':status'] = input.status;
        }

        if (input.notes !== undefined && input.notes !== null) {
          if (input.notes.length > ${INPUT_LIMITS.notes}) {
            return util.error('notes must be at most ${INPUT_LIMITS.notes} characters', 'ValidationError');
          }
          updateExpression.push('#notes = :notes');
          expressionNames['#notes'] = 'notes';
          expressionValues[':notes'] = input.notes;
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
            SK: \`ISSUE#\${issueId}\`
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
        if (!ctx.result) return util.error('Issue not found', 'NotFound');
        return ctx.result;
      }
    `,
  });
}
