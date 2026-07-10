/// <reference path="../../../.sst/platform/config.d.ts" />

const INPUT_LIMITS = {
  name: 100,
  bio: 500,
  avatar: 2048,
};

/**
 * Shared response normalizer for user profile resolvers.
 * Ensures userId and username are always present in the response,
 * falling back to Cognito identity claims when DynamoDB fields are empty.
 */
const normalizeProfileResponse = `
  function normalizeProfile(ctx) {
    if (ctx.error) return util.error(ctx.error.message, ctx.error.type);
    if (!ctx.result) return util.error('User profile not found', 'NotFound');

    const profile = ctx.result;
    if (!profile.userId) {
      profile.userId = ctx.identity.sub;
    }
    if (!profile.username) {
      const email = profile.email
        || ctx.identity.claims?.['cognito:username']
        || ctx.identity.claims?.email
        || '';
      profile.username = email.includes('@') ? email.split('@')[0] : 'user';
    }
    return profile;
  }
`;

export function addUserResolvers(
  api: ReturnType<typeof import('../api-setup').createApi>,
  dynamoDataSource: ReturnType<typeof import('../api-setup').createDataSource>,
  _tableName: string
) {
  api.addResolver('Query getMyProfile', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';
      ${normalizeProfileResponse}
      export function request(ctx) {
        return {
          operation: 'GetItem',
          key: util.dynamodb.toMapValues({
            PK: \`USER#\${ctx.identity.sub}\`,
            SK: 'PROFILE'
          })
        };
      }
      
      export function response(ctx) {
        return normalizeProfile(ctx);
      }
    `,
  });

  api.addResolver('Mutation updateUserProfile', {
    dataSource: dynamoDataSource.name,
    code: `
      import { util } from '@aws-appsync/utils';
      ${normalizeProfileResponse}
      export function request(ctx) {
        const userId = ctx.identity.sub;
        const input = ctx.args.input || {};

        if (input.name !== undefined && input.name !== null && input.name.length > ${INPUT_LIMITS.name}) {
          return util.error('name must be at most ${INPUT_LIMITS.name} characters', 'ValidationError');
        }
        if (input.bio !== undefined && input.bio !== null && input.bio.length > ${INPUT_LIMITS.bio}) {
          return util.error('bio must be at most ${INPUT_LIMITS.bio} characters', 'ValidationError');
        }
        if (input.avatar !== undefined && input.avatar !== null && input.avatar.length > ${INPUT_LIMITS.avatar}) {
          return util.error('avatar must be at most ${INPUT_LIMITS.avatar} characters', 'ValidationError');
        }

        const updateExpression = [];
        const expressionNames = {};
        const expressionValues = {};
        
        if (input.name !== undefined) {
          updateExpression.push('#name = :name');
          expressionNames['#name'] = 'name';
          expressionValues[':name'] = input.name;
        }
        
        if (input.bio !== undefined) {
          updateExpression.push('#bio = :bio');
          expressionNames['#bio'] = 'bio';
          expressionValues[':bio'] = input.bio;
        }
        
        if (input.avatar !== undefined) {
          updateExpression.push('#avatar = :avatar');
          expressionNames['#avatar'] = 'avatar';
          expressionValues[':avatar'] = input.avatar;
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
            SK: 'PROFILE'
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
        return normalizeProfile(ctx);
      }
    `,
  });
}
