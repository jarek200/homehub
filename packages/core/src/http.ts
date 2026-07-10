export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}

export function errorBody(error: unknown): ErrorBody {
  if (error instanceof ApiError) {
    return {
      error: error.message,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    return { error: error.message };
  }

  return { error: 'Internal server error' };
}

export function statusCodeForError(error: unknown): number {
  if (error instanceof ApiError) {
    return error.statusCode;
  }
  return 500;
}
