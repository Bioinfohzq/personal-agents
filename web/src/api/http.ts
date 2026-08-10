export const BUSINESS_API_URL = import.meta.env.VITE_BUSINESS_API_URL ?? 'http://127.0.0.1:8080';

export class BusinessApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'BusinessApiError';
    this.status = status;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof BusinessApiError && error.status === 401;
}

export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json() as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function businessFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${BUSINESS_API_URL}${path}`, {
    ...init,
    headers,
  });
}

export async function assertBusinessResponse(response: Response, fallback: string): Promise<Response> {
  if (response.ok) {
    return response;
  }

  throw new BusinessApiError(response.status, await readErrorMessage(response, fallback));
}
