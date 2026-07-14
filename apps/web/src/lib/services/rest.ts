import { fetchAuthSession } from 'aws-amplify/auth';

export class RestApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'RestApiError';
  }
}

function baseUrl(): string {
  if (typeof window !== 'undefined') {
    const win = window as Window & { ENV?: Record<string, string> };
    const url = win.ENV?.VITE_REST_API_URL ?? import.meta.env.VITE_REST_API_URL;
    if (url) return url.replace(/\/$/, '');
  }
  const url = import.meta.env.VITE_REST_API_URL;
  if (!url) {
    throw new RestApiError('REST API URL is not configured', 0, 'ConfigError');
  }
  return url.replace(/\/$/, '');
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      return headers;
    }
  } catch {
    // fall through to API key
  }

  const apiKey = import.meta.env.VITE_REST_API_KEY;
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }

  return headers;
}

export async function restRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {}
): Promise<T> {
  const headers = await authHeaders();
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl()}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };

  if (!response.ok) {
    throw new RestApiError(
      payload.error ?? `Request failed (${response.status})`,
      response.status,
      payload.code
    );
  }

  return payload as T;
}
