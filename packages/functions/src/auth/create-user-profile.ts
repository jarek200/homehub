/**
 * Lambda Handler: Create User Profile
 *
 * Triggered by Cognito post-confirmation event when a user signs up.
 * Creates a user profile in DynamoDB.
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

    // Create user profile in DynamoDB
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: 'PROFILE',
          userId,
          username,
          email,
          name: null,
          bio: null,
          avatar: null,
          createdAt,
          updatedAt: createdAt,
          // GSI1: User-centric queries
          GSI1PK: `USER#${userId}`,
          GSI1SK: 'PROFILE',
          // GSI2: Global queries (if needed)
          GSI2PK: 'USER',
          GSI2SK: createdAt,
        },
      })
    );

    console.log('User profile created successfully', { userId, email });

    return event;
  } catch (error) {
    console.error('Error creating user profile:', error);
    // Don't throw - allow user creation to succeed even if profile creation fails
    // The profile can be created later via GraphQL mutation
    return event;
  }
};
