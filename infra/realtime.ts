/// <reference path="../.sst/platform/config.d.ts" />

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as aws from '@pulumi/aws';
import { pythonLambdaEnv } from './python-lambda';
import { stageConfig } from './stage-config';

type StorageTable = ReturnType<typeof import('./storage').createStorage>['table'];
type AuthPool = ReturnType<typeof import('./auth').createAuth>['auth'];

const HOUSEHOLD_NAMESPACE = 'household';
const HANDLER_PATH = path.join(process.cwd(), 'infra/appsync-handlers/household.js');

export function createRealtime(table: StorageTable, auth: AuthPool) {
  const region = aws.getRegionOutput().name;
  const accountId = aws.getCallerIdentityOutput().accountId;
  const streamArn = table.nodes.table.apply((resource) => {
    if (!resource.streamArn) {
      throw new Error('AppTable stream ARN is required for household event publishing');
    }
    return resource.streamArn;
  });

  const eventsApi = new aws.appsync.Api('HouseholdEventsApi', {
    name: `${$app.name}-${$app.stage}-events`,
    eventConfig: {
      authProviders: [
        { authType: 'AWS_IAM' },
        {
          authType: 'AMAZON_COGNITO_USER_POOLS',
          cognitoConfig: {
            userPoolId: auth.id,
            awsRegion: region,
          },
        },
      ],
      connectionAuthModes: [{ authType: 'AMAZON_COGNITO_USER_POOLS' }],
      defaultPublishAuthModes: [{ authType: 'AWS_IAM' }],
      defaultSubscribeAuthModes: [{ authType: 'AMAZON_COGNITO_USER_POOLS' }],
    },
  });

  const householdNamespace = new aws.appsync.ChannelNamespace('HouseholdChannelNamespace', {
    apiId: eventsApi.apiId,
    name: HOUSEHOLD_NAMESPACE,
    codeHandlers: fs.readFileSync(HANDLER_PATH, 'utf8'),
    publishAuthModes: [{ authType: 'AWS_IAM' }],
    subscribeAuthModes: [{ authType: 'AMAZON_COGNITO_USER_POOLS' }],
  });

  const httpHost = eventsApi.dns.apply((dns) => dns.HTTP ?? dns.http);
  const realtimeHost = eventsApi.dns.apply((dns) => dns.REALTIME ?? dns.realtime);
  const eventsHttpUrl = httpHost.apply((host) => `https://${host}/event`);
  const eventsRealtimeUrl = realtimeHost.apply((host) => `wss://${host}/event`);

  const failureQueue = new aws.sqs.Queue('HouseholdEventFailures', {
    messageRetentionSeconds: 14 * 24 * 60 * 60,
  });

  const publisher = new sst.aws.Function('HouseholdEventPublisher', {
    handler: 'services/api/src/homehub_api/iot/household_events.handler',
    runtime: 'python3.13',
    memory: stageConfig.lambda.memory,
    timeout: stageConfig.lambda.timeout,
    dev: false,
    link: [table],
    environment: {
      ...pythonLambdaEnv,
      TABLE_NAME: table.name,
      APPSYNC_EVENTS_HTTP_URL: eventsHttpUrl,
      POWERTOOLS_SERVICE_NAME: 'homehub-household-events',
      POWERTOOLS_METRICS_NAMESPACE: 'HomeHub',
      POWERTOOLS_LOG_LEVEL: 'INFO',
    },
    permissions: [
      {
        actions: ['appsync:EventPublish'],
        resources: [householdNamespace.channelNamespaceArn],
      },
      {
        actions: [
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:ListStreams',
        ],
        resources: [streamArn, $interpolate`${table.arn}/stream/*`],
      },
      {
        actions: ['sqs:SendMessage'],
        resources: [failureQueue.arn],
      },
    ],
  });

  new aws.lambda.EventSourceMapping(
    'HouseholdStateStream',
    {
      eventSourceArn: streamArn,
      functionName: publisher.arn,
      startingPosition: 'LATEST',
      batchSize: 10,
      maximumBatchingWindowInSeconds: 0,
      parallelizationFactor: 1,
      bisectBatchOnFunctionError: true,
      maximumRetryAttempts: 3,
      functionResponseTypes: ['ReportBatchItemFailures'],
      destinationConfig: {
        onFailure: {
          destinationArn: failureQueue.arn,
        },
      },
      filterCriteria: {
        filters: [
          {
            pattern: JSON.stringify({
              dynamodb: {
                Keys: {
                  SK: { S: ['HUB_STATE'] },
                },
              },
            }),
          },
        ],
      },
    },
    { dependsOn: [publisher, failureQueue] }
  );

  const alertTopic = new aws.sns.Topic('RealtimeAlerts', {
    name: `${$app.name}-${$app.stage}-realtime-alerts`,
  });

  const alertInbox = new aws.sqs.Queue('RealtimeAlertInbox', {
    messageRetentionSeconds: 14 * 24 * 60 * 60,
  });

  const alertInboxPolicy = new aws.sqs.QueuePolicy('RealtimeAlertInboxPolicy', {
    queueUrl: alertInbox.url,
    policy: $jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowRealtimeAlerts',
          Effect: 'Allow',
          Principal: { Service: 'sns.amazonaws.com' },
          Action: 'sqs:SendMessage',
          Resource: alertInbox.arn,
          Condition: {
            ArnEquals: { 'aws:SourceArn': alertTopic.arn },
          },
        },
      ],
    }),
  });

  new aws.sns.TopicSubscription(
    'RealtimeAlertInboxSubscription',
    {
      topic: alertTopic.arn,
      protocol: 'sqs',
      endpoint: alertInbox.arn,
      rawMessageDelivery: true,
    },
    { dependsOn: [alertInboxPolicy] }
  );

  new aws.sns.TopicPolicy('RealtimeAlertsPolicy', {
    arn: alertTopic.arn,
    policy: alertTopic.arn.apply((arn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowCloudWatch',
            Effect: 'Allow',
            Principal: { Service: 'cloudwatch.amazonaws.com' },
            Action: 'sns:Publish',
            Resource: arn,
          },
          {
            Sid: 'AllowBudgets',
            Effect: 'Allow',
            Principal: { Service: 'budgets.amazonaws.com' },
            Action: 'sns:Publish',
            Resource: arn,
          },
        ],
      })
    ),
  });

  new aws.cloudwatch.MetricAlarm('HouseholdPublisherErrors', {
    name: `${$app.name}-${$app.stage}-household-publisher-errors`,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    evaluationPeriods: 1,
    metricName: 'PublishFailure',
    namespace: 'HomeHub',
    period: 300,
    statistic: 'Sum',
    threshold: 1,
    treatMissingData: 'notBreaching',
    dimensions: {
      service: 'homehub-api',
    },
    alarmActions: [alertTopic.arn],
  });

  new aws.cloudwatch.MetricAlarm('HouseholdPublisherInvocationErrors', {
    name: `${$app.name}-${$app.stage}-household-publisher-invocation-errors`,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    evaluationPeriods: 1,
    metricName: 'Errors',
    namespace: 'AWS/Lambda',
    period: 300,
    statistic: 'Sum',
    threshold: 1,
    treatMissingData: 'notBreaching',
    dimensions: {
      FunctionName: publisher.nodes.function.name,
    },
    alarmActions: [alertTopic.arn],
  });

  new aws.cloudwatch.MetricAlarm('HouseholdFailureQueueDepth', {
    name: `${$app.name}-${$app.stage}-household-failure-queue-depth`,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    evaluationPeriods: 1,
    metricName: 'ApproximateNumberOfMessagesVisible',
    namespace: 'AWS/SQS',
    period: 300,
    statistic: 'Maximum',
    threshold: 1,
    treatMissingData: 'notBreaching',
    dimensions: {
      QueueName: failureQueue.name,
    },
    alarmActions: [alertTopic.arn],
  });

  new aws.cloudwatch.MetricAlarm('HouseholdEventAge', {
    name: `${$app.name}-${$app.stage}-household-event-age`,
    comparisonOperator: 'GreaterThanThreshold',
    evaluationPeriods: 1,
    metricName: 'SourceToPublishLatencyMs',
    namespace: 'HomeHub',
    period: 300,
    extendedStatistic: 'p95',
    threshold: 2000,
    treatMissingData: 'notBreaching',
    dimensions: {
      service: 'homehub-api',
    },
    alarmActions: [alertTopic.arn],
  });

  new aws.cloudwatch.MetricAlarm('HouseholdStreamIteratorAge', {
    name: `${$app.name}-${$app.stage}-household-stream-iterator-age`,
    comparisonOperator: 'GreaterThanThreshold',
    evaluationPeriods: 1,
    metricName: 'IteratorAge',
    namespace: 'AWS/Lambda',
    period: 300,
    statistic: 'Maximum',
    threshold: 60000,
    treatMissingData: 'notBreaching',
    dimensions: {
      FunctionName: publisher.nodes.function.name,
    },
    alarmActions: [alertTopic.arn],
  });

  new aws.cloudwatch.MetricAlarm('HouseholdEventsAuthFailures', {
    name: `${$app.name}-${$app.stage}-household-events-auth-failures`,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    evaluationPeriods: 1,
    metricName: '4XXError',
    namespace: 'AWS/AppSync',
    period: 300,
    statistic: 'Sum',
    threshold: 5,
    treatMissingData: 'notBreaching',
    dimensions: {
      EventAPIId: eventsApi.apiId,
    },
    alarmActions: [alertTopic.arn],
  });

  new aws.budgets.Budget('AppSyncEventsBudget', {
    name: `${$app.name}-${$app.stage}-appsync-events`,
    budgetType: 'COST',
    limitAmount: '1',
    limitUnit: 'USD',
    timeUnit: 'MONTHLY',
    costFilters: [
      {
        name: 'Service',
        values: ['AWS AppSync'],
      },
    ],
    notifications: [
      {
        comparisonOperator: 'GREATER_THAN',
        threshold: 80,
        thresholdType: 'PERCENTAGE',
        notificationType: 'ACTUAL',
        subscriberSnsTopicArns: [alertTopic.arn],
      },
    ],
  });

  return {
    eventsApi,
    householdNamespace,
    eventsHttpUrl,
    eventsRealtimeUrl,
    namespace: HOUSEHOLD_NAMESPACE,
    publisher,
    failureQueue,
    alertTopic,
    alertInbox,
    accountId,
    region,
  };
}
