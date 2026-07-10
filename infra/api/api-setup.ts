/// <reference path="../../.sst/platform/config.d.ts" />

export function createApi(auth: ReturnType<typeof import('../auth').createAuth>['auth']) {
  // AppSync GraphQL API
  const api = new sst.aws.AppSync('Api', {
    schema: 'packages/graphql/schema.graphql',
    transform: {
      api: (args) => {
        args.authenticationType = 'AMAZON_COGNITO_USER_POOLS';
        args.userPoolConfig = {
          userPoolId: auth.id,
          defaultAction: 'ALLOW',
        };
      },
    },
  });

  return api;
}

export function createDataSource(
  api: ReturnType<typeof createApi>,
  table: ReturnType<typeof import('../storage').createStorage>['table']
) {
  // Link DynamoDB to AppSync as data source
  // Avoid name `dynamodb` — AppSync/SST may already expose that name and creation fails with "already exists".
  const dynamoDataSource = api.addDataSource({
    name: 'AppTableDynamo',
    dynamodb: table.arn,
    transform: {
      serviceRole: {
        inlinePolicies: [
          {
            policy: $jsonStringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: [
                    'dynamodb:Query',
                    'dynamodb:Scan',
                    'dynamodb:GetItem',
                    'dynamodb:PutItem',
                    'dynamodb:UpdateItem',
                    'dynamodb:DeleteItem',
                    'dynamodb:BatchGetItem',
                    'dynamodb:BatchWriteItem',
                  ],
                  Resource: [table.arn, $interpolate`${table.arn}/index/*`],
                },
              ],
            }),
          },
        ],
      },
    },
  });

  return dynamoDataSource;
}

export function createLambdaDataSource(
  api: ReturnType<typeof createApi>,
  lambdaArn: $util.Input<string>,
  options?: { name?: string }
) {
  return api.addDataSource({
    name: options?.name ?? 'lambda',
    lambda: lambdaArn,
  });
}
