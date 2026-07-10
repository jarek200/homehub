import { type ZodError, type ZodIssue, z } from 'zod';
import { ApiError } from './http';

export function parseBody<T extends z.ZodType>(
  schema: T,
  body: string | null | undefined
): z.infer<T> {
  if (!body) {
    throw new ApiError('Request body is required', 400, 'ValidationError');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ApiError('Invalid JSON body', 400, 'ValidationError');
  }

  return parseValue(schema, parsed);
}

export function parseValue<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const zodError = error as ZodError<unknown>;
      const message = zodError.issues.map((issue: ZodIssue) => issue.message).join('; ');
      throw new ApiError(message, 400, 'ValidationError');
    }
    throw error;
  }
}
