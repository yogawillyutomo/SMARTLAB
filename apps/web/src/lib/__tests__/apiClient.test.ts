import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, buildApiUrl, createApiClient, normalizeApiOrigin, readXsrfToken } from '@/lib/apiClient';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('API URL and cookie handling', () => {
  it('normalizes origins and joins API paths without duplicate boundary slashes', () => {
    expect(normalizeApiOrigin(undefined)).toBe('');
    expect(normalizeApiOrigin(' / ')).toBe('');
    expect(normalizeApiOrigin('https://api.example.test///')).toBe('https://api.example.test');
    expect(normalizeApiOrigin('https://api.example.test/root//')).toBe('https://api.example.test/root');
    expect(buildApiUrl('https://api.example.test/', '/me')).toBe('https://api.example.test/api/v1/me');
    expect(() => buildApiUrl('https://api.example.test', 'https://evil.test')).toThrow(ApiClientError);
  });

  it('rejects unsafe API origin configuration', () => {
    expect(() => normalizeApiOrigin('javascript:alert(1)')).toThrow(ApiClientError);
    expect(() => normalizeApiOrigin('https://user:secret@api.example.test')).toThrow(ApiClientError);
  });

  it('defers invalid environment configuration to a controlled request error', async () => {
    const client = createApiClient({ apiOrigin: 'not a valid origin' });
    await expect(client.get('/me')).rejects.toMatchObject({ kind: 'configuration' });
  });

  it('decodes Laravel XSRF cookies safely', () => {
    expect(readXsrfToken('theme=dark; XSRF-TOKEN=token%3Dvalue%2Bsafe')).toBe('token=value+safe');
    expect(readXsrfToken('XSRF-TOKEN=%E0%A4%A')).toBeNull();
    expect(readXsrfToken('theme=dark')).toBeNull();
  });
});

describe('API transport contracts', () => {
  it('acquires the CSRF cookie with credentials and accepts a 204 without JSON parsing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 204 });
    });
    const client = createApiClient({ apiOrigin: 'http://localhost:8000/', fetchImpl: fetchMock as typeof fetch });

    await expect(client.ensureCsrfCookie()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/sanctum/csrf-cookie');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Accept')).toBe('application/json');
  });

  it('sends decoded XSRF, JSON, Accept, and credentials headers on mutations', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 204 });
    });
    const client = createApiClient({
      fetchImpl: fetchMock as typeof fetch,
      readCookie: () => 'XSRF-TOKEN=csrf%3Dtoken',
    });

    await expect(client.post('/auth/login', { remember: true })).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: JSON.stringify({ remember: true }) });
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-XSRF-TOKEN')).toBe('csrf=token');
  });

  it('includes credentials and Accept on authenticated reads', async () => {
    const readCookie = vi.fn(() => 'XSRF-TOKEN=should-not-be-read');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ data: {} });
    });
    const client = createApiClient({ fetchImpl: fetchMock as typeof fetch, readCookie });

    await client.get('/me');
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBeNull();
    expect(headers.get('X-XSRF-TOKEN')).toBeNull();
    expect(readCookie).not.toHaveBeenCalled();
  });

  it('sends PATCH mutations with credentials, JSON headers, and the decoded XSRF token', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return jsonResponse({ data: { id: '01LAB' } });
    });
    const client = createApiClient({
      fetchImpl: fetchMock as typeof fetch,
      readCookie: () => 'XSRF-TOKEN=patch%3Dtoken',
    });

    await client.patch('/laboratories/01LAB', { status: 'inactive' });

    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(url).toBe('/api/v1/laboratories/01LAB');
    expect(init).toMatchObject({
      method: 'PATCH',
      credentials: 'include',
      body: JSON.stringify({ status: 'inactive' }),
    });
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-XSRF-TOKEN')).toBe('patch=token');
    expect(headers.get('If-Match')).toBeNull();
  });

  it('adds only the narrow PATCH If-Match option without changing standard mutation headers', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 204 });
    });
    const client = createApiClient({
      fetchImpl: fetchMock as typeof fetch,
      readCookie: () => 'XSRF-TOKEN=csrf-token',
    });

    await client.patch('/devices/01DEVICE', { hostname: 'PC-01' }, { ifMatch: '"3"' });

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('If-Match')).toBe('"3"');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-XSRF-TOKEN')).toBe('csrf-token');
  });

  it('sends PUT, bodyless activation POST, and DELETE with exact shared mutation options', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 204 });
    });
    const client = createApiClient({
      fetchImpl: fetchMock as typeof fetch,
      readCookie: () => 'XSRF-TOKEN=layout-csrf',
    });

    await client.put('/layouts/01LAYOUT', { name: 'Draft' }, { ifMatch: '"4"' });
    await client.post('/layouts/01LAYOUT/activate', undefined, { ifMatch: '"5"' });
    await client.delete('/layouts/01LAYOUT', { ifMatch: '"6"' });

    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'POST', 'DELETE']);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ name: 'Draft' }));
    expect(fetchMock.mock.calls[1][1]?.body).toBeUndefined();
    expect(fetchMock.mock.calls[2][1]?.body).toBeUndefined();
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('If-Match')))
      .toEqual(['"4"', '"5"', '"6"']);
    fetchMock.mock.calls.forEach(([, init]) => {
      const headers = new Headers(init?.headers);
      expect(init?.credentials).toBe('include');
      expect(headers.get('Accept')).toBe('application/json');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('X-XSRF-TOKEN')).toBe('layout-csrf');
    });
  });

  it('parses stable API errors and Retry-After metadata', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      message: 'Too many login attempts. Please try again later.',
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
    }, 429, { 'Retry-After': '41' }));
    const client = createApiClient({ fetchImpl: fetchMock as typeof fetch });

    await expect(client.post('/auth/login', {})).rejects.toMatchObject({
      kind: 'api',
      status: 429,
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      retryAfter: 41,
    });
  });

  it('turns HTML and malformed JSON into controlled client errors', async () => {
    const htmlClient = createApiClient({
      fetchImpl: vi.fn(async () => new Response('<html>error</html>', { status: 500, headers: { 'Content-Type': 'text/html' } })) as typeof fetch,
    });
    await expect(htmlClient.get('/me')).rejects.toMatchObject({ kind: 'invalid_response', status: 500 });

    const malformedClient = createApiClient({
      fetchImpl: vi.fn(async () => new Response('{broken', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
    });
    await expect(malformedClient.get('/me')).rejects.toMatchObject({ kind: 'invalid_response', status: 200 });
  });

  it('refreshes CSRF and retries a 419 mutation exactly once', async () => {
    let cookie = 'XSRF-TOKEN=old';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.endsWith('/sanctum/csrf-cookie')) {
        cookie = 'XSRF-TOKEN=fresh';
        return new Response(null, { status: 204 });
      }
      const mutationCount = fetchMock.mock.calls.filter(([called]) => String(called).endsWith('/auth/logout')).length;
      return mutationCount === 1
        ? jsonResponse({ message: 'CSRF token mismatch.', code: 'CSRF_TOKEN_MISMATCH' }, 419)
        : new Response(null, { status: 204 });
    });
    const client = createApiClient({ fetchImpl: fetchMock as typeof fetch, readCookie: () => cookie });

    await expect(client.post('/auth/logout')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers);
    expect(retryHeaders.get('X-XSRF-TOKEN')).toBe('fresh');
  });

  it('never retries a second 419 response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      return String(input).endsWith('/sanctum/csrf-cookie')
        ? new Response(null, { status: 204 })
        : jsonResponse({ message: 'CSRF token mismatch.', code: 'CSRF_TOKEN_MISMATCH' }, 419);
    });
    const client = createApiClient({ fetchImpl: fetchMock as typeof fetch, readCookie: () => 'XSRF-TOKEN=token' });

    await expect(client.post('/auth/logout')).rejects.toMatchObject({ status: 419, code: 'CSRF_TOKEN_MISMATCH' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refreshes CSRF and retries a PATCH 419 response at most once', async () => {
    let cookie = 'XSRF-TOKEN=old';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.endsWith('/sanctum/csrf-cookie')) {
        cookie = 'XSRF-TOKEN=fresh';
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ message: 'CSRF token mismatch.', code: 'CSRF_TOKEN_MISMATCH' }, 419);
    });
    const client = createApiClient({ fetchImpl: fetchMock as typeof fetch, readCookie: () => cookie });

    await expect(client.patch('/devices/01DEVICE', { name: 'Updated' }, { ifMatch: '"7"' })).rejects.toMatchObject({
      status: 419,
      code: 'CSRF_TOKEN_MISMATCH',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PATCH', 'GET', 'PATCH']);
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('X-XSRF-TOKEN')).toBe('fresh');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('If-Match')).toBe('"7"');
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('If-Match')).toBe('"7"');
  });

  it.each([
    ['POST', (client: ReturnType<typeof createApiClient>) => client.post('/layouts/01LAYOUT/activate', undefined, { ifMatch: '"8"' })],
    ['PUT', (client: ReturnType<typeof createApiClient>) => client.put('/layouts/01LAYOUT', { name: 'Draft' }, { ifMatch: '"8"' })],
    ['DELETE', (client: ReturnType<typeof createApiClient>) => client.delete('/layouts/01LAYOUT', { ifMatch: '"8"' })],
  ])('refreshes CSRF and retries a %s Layout mutation once while preserving If-Match', async (method, invoke) => {
    let cookie = 'XSRF-TOKEN=old';
    let mutationCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      if (String(input).endsWith('/sanctum/csrf-cookie')) {
        cookie = 'XSRF-TOKEN=fresh';
        return new Response(null, { status: 204 });
      }
      mutationCalls += 1;
      return mutationCalls === 1
        ? jsonResponse({ message: 'CSRF token mismatch.', code: 'CSRF_TOKEN_MISMATCH' }, 419)
        : new Response(null, { status: 204 });
    });
    const client = createApiClient({ fetchImpl: fetchMock as typeof fetch, readCookie: () => cookie });

    await expect(invoke(client)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([method, 'GET', method]);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('If-Match')).toBe('"8"');
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('If-Match')).toBe('"8"');
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('X-XSRF-TOKEN')).toBe('fresh');
  });

  it('never turns a network failure into success', async () => {
    const client = createApiClient({
      fetchImpl: vi.fn(async () => { throw new TypeError('offline'); }) as typeof fetch,
    });
    await expect(client.get('/me')).rejects.toMatchObject({ kind: 'network' });
  });
});
