import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/apiClient';
import { clearLegacyAuthStorage } from '@/lib/authStorage';
import { createAuthStoreForTesting } from '@/stores/authStore';
import type { AuthGateway, CurrentUserPayload } from '@/services/authApi';

const currentUser: CurrentUserPayload = {
  id: '01USER',
  name: 'Admin SmartLab',
  email: 'admin@example.test',
  school: { id: '01SCHOOL', code: 'SMK-01', name: 'SMK SmartLab' },
  membership: { id: '01MEMBER', status: 'active', roles: ['Admin Lab', 'Guru'] },
  permissions: ['assets.view', 'laboratories.view'],
};

function apiError(status: number, code: string, message = code, retryAfter?: number): ApiClientError {
  return new ApiClientError(message, { kind: 'api', status, code, retryAfter });
}

function gateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    getCurrentUser: vi.fn(async () => currentUser),
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

describe('session bootstrap', () => {
  it('establishes the exact authenticated principal and deduplicates StrictMode bootstrap calls', async () => {
    const pending = deferred<CurrentUserPayload>();
    const authGateway = gateway({ getCurrentUser: vi.fn(() => pending.promise) });
    const cleanup = vi.fn();
    const store = createAuthStoreForTesting({ gateway: authGateway, clearLegacyAuth: cleanup });

    const first = store.getState().bootstrapSession();
    const second = store.getState().bootstrapSession();
    expect(first).toBe(second);
    expect(authGateway.getCurrentUser).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();

    pending.resolve(currentUser);
    await first;
    expect(store.getState()).toMatchObject({ status: 'authenticated', isAuthenticated: true, issue: null });
    expect(store.getState().user?.membership.roles).toEqual(['Admin Lab', 'Guru']);
    expect(store.getState().user?.permissions).toEqual(['assets.view', 'laboratories.view']);
  });

  it('treats a confirmed 401 as unauthenticated', async () => {
    const store = createAuthStoreForTesting({
      gateway: gateway({ getCurrentUser: vi.fn(async () => { throw apiError(401, 'UNAUTHENTICATED'); }) }),
      clearLegacyAuth: vi.fn(),
    });
    await store.getState().bootstrapSession();
    expect(store.getState()).toMatchObject({ status: 'unauthenticated', isAuthenticated: false, user: null, issue: null });
  });

  it('keeps bootstrap network failure distinct from an ordinary guest', async () => {
    const store = createAuthStoreForTesting({
      gateway: gateway({ getCurrentUser: vi.fn(async () => { throw new ApiClientError('offline', { kind: 'network' }); }) }),
      clearLegacyAuth: vi.fn(),
    });
    await store.getState().bootstrapSession();
    expect(store.getState()).toMatchObject({
      status: 'error',
      isAuthenticated: false,
      issue: { code: 'AUTH_SERVICE_UNAVAILABLE', retryable: true },
    });
  });

  it('keeps an exhausted CSRF retry distinct from an ordinary guest', async () => {
    const store = createAuthStoreForTesting({
      gateway: gateway({ getCurrentUser: vi.fn(async () => { throw apiError(419, 'CSRF_TOKEN_MISMATCH'); }) }),
      clearLegacyAuth: vi.fn(),
    });
    await store.getState().bootstrapSession();
    expect(store.getState()).toMatchObject({
      status: 'error',
      issue: { code: 'CSRF_RETRY_FAILED', retryable: true },
    });
  });

  it('can force an authoritative /me recheck after an API-integrated feature receives 401', async () => {
    const getCurrentUser = vi.fn()
      .mockResolvedValueOnce(currentUser)
      .mockRejectedValueOnce(apiError(401, 'UNAUTHENTICATED'));
    const store = createAuthStoreForTesting({
      gateway: gateway({ getCurrentUser }),
      clearLegacyAuth: vi.fn(),
    });

    await store.getState().bootstrapSession();
    expect(store.getState().status).toBe('authenticated');
    await store.getState().bootstrapSession({ force: true });

    expect(getCurrentUser).toHaveBeenCalledTimes(2);
    expect(store.getState()).toMatchObject({ status: 'unauthenticated', isAuthenticated: false, user: null });
  });
});

describe('login orchestration and failures', () => {
  it('marks authenticated only after login and current-user both succeed', async () => {
    const order: string[] = [];
    const authGateway = gateway({
      login: vi.fn(async (_email, _password, remember) => { order.push(`login:${remember}`); }),
      getCurrentUser: vi.fn(async () => { order.push('me'); return currentUser; }),
    });
    const store = createAuthStoreForTesting({ gateway: authGateway, clearLegacyAuth: vi.fn() });

    const result = await store.getState().login('admin@example.test', 'secret', false);
    expect(result).toEqual({ ok: true });
    expect(order).toEqual(['login:false', 'me']);
    expect(store.getState()).toMatchObject({ status: 'authenticated', isAuthenticated: true });
  });

  it.each([
    [401, 'INVALID_CREDENTIALS', undefined],
    [422, 'VALIDATION_FAILED', undefined],
    [429, 'TOO_MANY_LOGIN_ATTEMPTS', 37],
  ])('preserves expected login error %s %s', async (status, code, retryAfter) => {
    const store = createAuthStoreForTesting({
      gateway: gateway({ login: vi.fn(async () => { throw apiError(status, code, code, retryAfter); }) }),
      clearLegacyAuth: vi.fn(),
    });
    const result = await store.getState().login('admin@example.test', 'secret', true);
    expect(result).toMatchObject({ ok: false, issue: { code, retryAfter } });
    expect(store.getState()).toMatchObject({ status: 'unauthenticated', isAuthenticated: false, user: null });
  });

  it('does not grant access when login succeeds but /me has a membership-context conflict', async () => {
    const store = createAuthStoreForTesting({
      gateway: gateway({ getCurrentUser: vi.fn(async () => { throw apiError(409, 'ACTIVE_MEMBERSHIP_REQUIRED'); }) }),
      clearLegacyAuth: vi.fn(),
    });
    const result = await store.getState().login('admin@example.test', 'secret', false);
    expect(result).toMatchObject({ ok: false, issue: { code: 'ACTIVE_MEMBERSHIP_REQUIRED' } });
    expect(store.getState()).toMatchObject({ status: 'context_error', isAuthenticated: false, user: null });
  });

  it('deduplicates concurrent login submissions', async () => {
    const pending = deferred<void>();
    const authGateway = gateway({ login: vi.fn(() => pending.promise) });
    const store = createAuthStoreForTesting({ gateway: authGateway, clearLegacyAuth: vi.fn() });

    const first = store.getState().login('first@example.test', 'first-secret', false);
    const second = store.getState().login('second@example.test', 'second-secret', true);
    expect(first).toBe(second);
    expect(authGateway.login).toHaveBeenCalledOnce();
    pending.resolve();
    await first;
  });
});

describe('current-session logout', () => {
  async function authenticatedStore(authGateway: AuthGateway) {
    const store = createAuthStoreForTesting({ gateway: authGateway, clearLegacyAuth: vi.fn() });
    await store.getState().bootstrapSession();
    return store;
  }

  it('clears the in-memory principal only after confirmed logout', async () => {
    const store = await authenticatedStore(gateway());
    expect(await store.getState().logout()).toEqual({ ok: true });
    expect(store.getState()).toMatchObject({ status: 'unauthenticated', isAuthenticated: false, user: null });
  });

  it('treats logout 401 as an already-ended session', async () => {
    const store = await authenticatedStore(gateway({ logout: vi.fn(async () => { throw apiError(401, 'UNAUTHENTICATED'); }) }));
    expect(await store.getState().logout()).toEqual({ ok: true });
    expect(store.getState()).toMatchObject({ status: 'unauthenticated', user: null });
  });

  it('retains the principal and reports failure when logout cannot be confirmed', async () => {
    const store = await authenticatedStore(gateway({
      logout: vi.fn(async () => { throw new ApiClientError('offline', { kind: 'network' }); }),
    }));
    const before = store.getState().user;
    const result = await store.getState().logout();
    expect(result).toMatchObject({ ok: false, issue: { code: 'AUTH_SERVICE_UNAVAILABLE' } });
    expect(store.getState()).toMatchObject({ status: 'authenticated', isAuthenticated: true, user: before });
  });

  it('deduplicates concurrent logout submissions', async () => {
    const pending = deferred<void>();
    const authGateway = gateway({ logout: vi.fn(() => pending.promise) });
    const store = await authenticatedStore(authGateway);
    const first = store.getState().logout();
    const second = store.getState().logout();
    expect(first).toBe(second);
    expect(authGateway.logout).toHaveBeenCalledOnce();
    pending.resolve();
    await first;
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  writes = 0;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.writes += 1; this.values.set(key, value); }
  seed(key: string, value: string) { this.values.set(key, value); }
}

describe('legacy auth storage cleanup', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('removes only the legacy AUTH key from both storage scopes', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.seed('smartlab_pplg_auth', '{"userId":"legacy"}');
    local.seed('smartlab_pplg_data', '{"labs":[]}');
    local.seed('smartlab_pplg_ui', '{"theme":"dark"}');
    session.seed('smartlab_pplg_auth', '{"userId":"legacy"}');
    session.seed('unrelated', 'keep');
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);

    clearLegacyAuthStorage();
    expect(local.getItem('smartlab_pplg_auth')).toBeNull();
    expect(session.getItem('smartlab_pplg_auth')).toBeNull();
    expect(local.getItem('smartlab_pplg_data')).toBe('{"labs":[]}');
    expect(local.getItem('smartlab_pplg_ui')).toBe('{"theme":"dark"}');
    expect(session.getItem('unrelated')).toBe('keep');
  });

  it('never persists session identity during bootstrap or login', async () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    const store = createAuthStoreForTesting({ gateway: gateway(), clearLegacyAuth: clearLegacyAuthStorage });

    await store.getState().bootstrapSession();
    expect(local.writes).toBe(0);
    expect(session.writes).toBe(0);
    expect(local.length).toBe(0);
    expect(session.length).toBe(0);
  });
});
