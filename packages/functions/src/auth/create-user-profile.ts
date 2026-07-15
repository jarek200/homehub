/**
 * Lambda Handler: Create User Profile
 *
 * Triggered by Cognito post-confirmation event when a user signs up.
 * Creates a user profile and a per-user hub in DynamoDB.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { validateLambdaEnv } from '@sst-monorepo/core';
import type { PostConfirmationTriggerHandler } from 'aws-lambda';

// Validate environment variables at module load time
const env = validateLambdaEnv();
const TABLE_NAME = env.TABLE_NAME;

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler: PostConfirmationTriggerHandler = async (event) => {
  console.log('CreateUserProfile handler invoked', {
    userId: event.request.userAttributes.sub,
    email: event.request.userAttributes.email,
  });

  try {
    const userId = event.request.userAttributes.sub;
    const email = event.request.userAttributes.email || '';
    const username = email.includes('@') ? email.split('@')[0] : 'user';
    const createdAt = new Date().toISOString();
    const hubPk = `HUB#${userId}`;

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: hubPk,
          SK: 'METADATA',
          hubId: userId,
          ownerUserId: userId,
          createdAt,
          updatedAt: createdAt,
        },
      })
    );

    // Create user profile in DynamoDB
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: 'PROFILE',
          userId,
          hubId: userId,
          username,
          email,
          name: null,
          createdAt,
          updatedAt: createdAt,
        },
      })
    );

    console.log('User profile and hub created successfully', { userId, email, hubPk });

    return event;
  } catch (error) {
    console.error('Error creating user profile:', error);
    // Don't throw - allow user creation to succeed even if profile creation fails
    // The profile can be created later via the REST API
    return event;
  }
};
