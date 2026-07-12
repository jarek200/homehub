export interface LambdaEnv {
  TABLE_NAME: string;
  AWS_REGION: string;
  NODE_ENV: 'development' | 'production' | 'test';
  REST_API_KEY?: string;
}

/**
 * Validates Lambda function environment variables.
 * Throws an error if validation fails.
 */
export function validateLambdaEnv(): LambdaEnv {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('Missing or invalid Lambda environment variables: TABLE_NAME');
  }

  const nodeEnv = process.env.NODE_ENV;
  const normalizedNodeEnv =
    nodeEnv === 'development' || nodeEnv === 'production' || nodeEnv === 'test'
      ? nodeEnv
      : 'production';

  return {
    TABLE_NAME: tableName,
    AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
    NODE_ENV: normalizedNodeEnv,
    REST_API_KEY: process.env.REST_API_KEY,
  };
}
