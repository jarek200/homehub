import { type ZodError, type ZodIssue, z } from 'zod';

/**
 * Environment variable validation schema
 * Use this to validate environment variables at runtime
 */
export const envSchema = z.object({
  // AWS Configuration
  AWS_REGION: z.string().default('us-east-1'),
  VITE_AWS_REGION: z.string().optional(),

  // Cognito
  VITE_USER_POOL_ID: z.string().optional(),
  VITE_USER_POOL_CLIENT_ID: z.string().optional(),

  // AppSync
  VITE_GRAPHQL_ENDPOINT: z.string().url().optional(),

  // DynamoDB (server-side only, set via SST link)
  TABLE_NAME: z.string().optional(),

  // REST API (optional API key for demo tenant endpoints)
  REST_API_KEY: z.string().optional(),

  // Stage - accepts any string to support custom SST stage names (feature branches, PR previews, etc.)
  VITE_STAGE: z.string().optional(),

  // Public app URL when a custom domain is configured for the deployed stage
  VITE_APP_URL: z.string().url().optional(),

  // Node Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates and returns environment variables
 * Throws an error if validation fails
 */
export function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const zodError = error as ZodError<unknown>;
      const missing = zodError.issues.map((e: ZodIssue) => e.path.join('.')).join(', ');
      throw new Error(`Missing or invalid environment variables: ${missing}`);
    }
    throw error;
  }
}

/**
 * Safe environment variable access with defaults
 * Use this in client-side code where env vars might be undefined
 */
export function getEnv(): Partial<Env> {
  try {
    return envSchema.partial().parse(process.env);
  } catch {
    return {};
  }
}

/**
 * Lambda-specific environment schema
 * Validates required environment variables for Lambda functions
 */
export const lambdaEnvSchema = z.object({
  TABLE_NAME: z.string(),
  AWS_REGION: z.string().default('us-east-1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  REST_API_KEY: z.string().optional(),
});

export type LambdaEnv = z.infer<typeof lambdaEnvSchema>;

/**
 * Validates Lambda function environment variables
 * Throws an error if validation fails
 */
export function validateLambdaEnv(): LambdaEnv {
  try {
    return lambdaEnvSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const zodError = error as ZodError<unknown>;
      const missing = zodError.issues.map((e: ZodIssue) => e.path.join('.')).join(', ');
      throw new Error(`Missing or invalid Lambda environment variables: ${missing}`);
    }
    throw error;
  }
}
