/// <reference path="../../../.sst/platform/config.d.ts" />

import { addUserResolvers } from './users';

export function addAllResolvers(
  api: ReturnType<typeof import('../api-setup').createApi>,
  dynamoDataSource: ReturnType<typeof import('../api-setup').createDataSource>,
  tableName: string
) {
  addUserResolvers(api, dynamoDataSource, tableName);
}
