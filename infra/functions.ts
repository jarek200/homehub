/// <reference path="../.sst/platform/config.d.ts" />

import { stageConfig } from './stage-config';

export function createUserProfile(
  table: ReturnType<typeof import('./storage').createStorage>['table']
) {
  const createUserProfileFunction = new sst.aws.Function('CreateUserProfile', {
    handler: 'packages/functions/src/auth/create-user-profile.handler',
    runtime: 'nodejs24.x',
    memory: stageConfig.lambda.memory,
    timeout: stageConfig.lambda.timeout,
    link: [table],
    nodejs: {
      loader: {
        '.node': 'file',
      },
      esbuild: {
        external: ['fsevents', 'lightningcss'],
      },
    },
    environment: {
      TABLE_NAME: table.name,
    },
    permissions: [
      {
        actions: ['dynamodb:PutItem'],
        resources: [table.arn],
      },
    ],
  });

  return createUserProfileFunction;
}
