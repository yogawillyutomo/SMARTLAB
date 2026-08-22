import { describe, expect, it, vi } from 'vitest';
import { createAuthGateway, parseCurrentUserResponse } from '@/services/authApi';
import type { ApiClient } from '@/lib/apiClient';

const response = {
  data: {
    id: '01USER',
    name: 'Admin',
    email: 'admin@example.test',
    school: { id: '01SCHOOL', code: 'SMK-01', name: 'SMK SmartLab' },
    membership: { id: '01MEMBER', status: 'active', roles: ['Admin Lab', 'Guru'] },
    permissions: ['assets.view', 'laboratories.view'],
  },
};

describe('authentication gateway', () => {
  it('orchestrates CSRF then login with a real boolean, followed by current-user retrieval', async () => {
    const order: string[] = [];
    const post = vi.fn(async (path: string, body?: unknown) => {
      void path;
      void body;
    });
    const get = vi.fn(async (path: string) => {
      void path;
      return response;
    });
    const client: ApiClient = {
      ensureCsrfCookie: vi.fn(async () => { order.push('csrf'); }),
      async post<T = void>(path: string, body?: unknown) {
        order.push(`post:${JSON.stringify(body)}`);
        await post(path, body);
        return undefined as T;
      },
      async get<T>(path: string) {
        order.push('me');
        return await get(path) as T;
      },
      patch: vi.fn(async () => { throw new Error('PATCH is not used by the authentication gateway.'); }) as ApiClient['patch'],
    };
    const gateway = createAuthGateway(client);

    await gateway.login('admin@example.test', 'secret', true);
    const user = await gateway.getCurrentUser();

    expect(order).toEqual([
      'csrf',
      'post:{"email":"admin@example.test","password":"secret","remember":true}',
      'me',
    ]);
    expect(user.membership.roles).toEqual(['Admin Lab', 'Guru']);
    expect(user.permissions).toEqual(['assets.view', 'laboratories.view']);
  });

  it('rejects a malformed current-user contract', () => {
    expect(() => parseCurrentUserResponse({ data: { ...response.data, permissions: 'assets.view' } })).toThrow();
    expect(() => parseCurrentUserResponse({ data: { ...response.data, membership: { ...response.data.membership, status: 'inactive' } } })).toThrow();
  });
});
