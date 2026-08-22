export type ApiClientErrorKind = 'api' | 'configuration' | 'invalid_response' | 'network';

interface ApiClientErrorOptions {
  kind: ApiClientErrorKind;
  status?: number;
  code?: string;
  errors?: Record<string, string[]>;
  retryAfter?: number;
  cause?: unknown;
}

export class ApiClientError extends Error {
  readonly kind: ApiClientErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly errors?: Record<string, string[]>;
  readonly retryAfter?: number;
  readonly originalCause?: unknown;

  constructor(message: string, options: ApiClientErrorOptions) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.errors = options.errors;
    this.retryAfter = options.retryAfter;
    this.originalCause = options.cause;
  }
}

export interface ApiClient {
  ensureCsrfCookie: () => Promise<void>;
  get: <T>(path: string) => Promise<T>;
  post: <T = void>(path: string, body?: unknown) => Promise<T>;
  patch: <T = void>(path: string, body?: unknown) => Promise<T>;
}

interface ApiClientOptions {
  apiOrigin?: string;
  fetchImpl?: typeof fetch;
  readCookie?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseValidationErrors(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every(([, messages]) => Array.isArray(messages) && messages.every((message) => typeof message === 'string'))) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, string[]>;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

export function normalizeApiOrigin(value: string | undefined): string {
  const candidate = value?.trim() ?? '';
  if (candidate === '' || candidate === '/') return '';

  let url: URL;
  try {
    url = new URL(candidate);
  } catch (cause) {
    throw new ApiClientError('Konfigurasi origin API tidak valid.', { kind: 'configuration', cause });
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ApiClientError('Konfigurasi origin API tidak aman.', { kind: 'configuration' });
  }

  const pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return `${url.origin}${pathname}`;
}

export function buildApiUrl(apiOrigin: string | undefined, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new ApiClientError('Path API harus berupa path internal absolut.', { kind: 'configuration' });
  }
  return `${normalizeApiOrigin(apiOrigin)}/api/v1${path}`;
}

export function buildCsrfUrl(apiOrigin: string | undefined): string {
  return `${normalizeApiOrigin(apiOrigin)}/sanctum/csrf-cookie`;
}

export function readXsrfToken(cookieHeader: string): string | null {
  const rawToken = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('XSRF-TOKEN='))
    ?.slice('XSRF-TOKEN='.length);

  if (!rawToken) return null;
  try {
    return decodeURIComponent(rawToken);
  } catch {
    return null;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const text = await response.text();
  if (!contentType.includes('json') || text.trim() === '') {
    throw new ApiClientError('Server mengembalikan respons yang tidak dikenali.', {
      kind: 'invalid_response',
      status: response.status,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ApiClientError('Server mengembalikan JSON yang tidak valid.', {
      kind: 'invalid_response',
      status: response.status,
      cause,
    });
  }

  if (!response.ok) {
    if (!isRecord(payload) || typeof payload.message !== 'string' || typeof payload.code !== 'string') {
      throw new ApiClientError('Server mengembalikan error yang tidak dikenali.', {
        kind: 'invalid_response',
        status: response.status,
      });
    }

    throw new ApiClientError(payload.message, {
      kind: 'api',
      status: response.status,
      code: payload.code,
      errors: parseValidationErrors(payload.errors),
      retryAfter: parseRetryAfter(response.headers.get('retry-after')),
    });
  }

  return payload as T;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const apiOrigin = options.apiOrigin;
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const readCookie = options.readCookie ?? (() => (typeof document === 'undefined' ? '' : document.cookie));

  async function fetchResponse(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, init);
    } catch (cause) {
      if (cause instanceof ApiClientError) throw cause;
      throw new ApiClientError('Layanan autentikasi tidak dapat dijangkau.', { kind: 'network', cause });
    }
  }

  async function ensureCsrfCookie(): Promise<void> {
    const response = await fetchResponse(buildCsrfUrl(apiOrigin), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    await parseResponse<void>(response);
  }

  async function request<T>(path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown, csrfRetry = true): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    const mutation = method !== 'GET';
    if (mutation) {
      headers.set('Content-Type', 'application/json');
      const token = readXsrfToken(readCookie());
      if (token) headers.set('X-XSRF-TOKEN', token);
    }

    const response = await fetchResponse(buildApiUrl(apiOrigin, path), {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (mutation && response.status === 419 && csrfRetry) {
      await ensureCsrfCookie();
      return request<T>(path, method, body, false);
    }

    return parseResponse<T>(response);
  }

  return {
    ensureCsrfCookie,
    get: <T>(path: string) => request<T>(path, 'GET'),
    post: <T = void>(path: string, body?: unknown) => request<T>(path, 'POST', body),
    patch: <T = void>(path: string, body?: unknown) => request<T>(path, 'PATCH', body),
  };
}

export const apiClient = createApiClient({ apiOrigin: import.meta.env.VITE_API_ORIGIN });
