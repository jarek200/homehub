/**
 * Lambda Handler: Create User Profile
 *
 * Triggered by Cognito post-confirmation. Creates an idempotent user profile
 * without a household — bootstrap assigns household membership on first use.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PROFILE_SK, userPk, validateLambdaEnv } from '@homehub/core';
import type { PostConfirmationTriggerHandler } from 'aws-lambda';

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

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: userPk(userId),
          SK: PROFILE_SK,
          userId,
          username,
          email,
          name: null,
          householdId: null,
          role: null,
          createdAt,
          updatedAt: createdAt,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

    console.log('User profile created', { userId, email });
    return event;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      console.log('User profile already exists');
      return event;
    }
    console.error('Error creating user profile:', error);
    return event;
  }
};
