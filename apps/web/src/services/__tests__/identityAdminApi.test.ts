import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  IdentityAdminContractError,
  createIdentityAdminGateway,
  parseIdentityMembership,
  parseIdentityMembershipPage,
  parseIdentityRoleCollection,
  type CreateIdentityMembershipInput,
} from '@/services/identityAdminApi';

const membership = {
  id: '01MEMBERSHIP000000000000001',
  status: 'active' as const,
  user: {
    id: '01USER00000000000000000001',
    name: 'Admin SmartLab',
    email: 'admin@example.test',
    nip: '19880001',
    nis: null,
    phone: '08123456789',
    status: 'active' as const,
    lastLoginAt: '2026-09-03T02:00:00.000Z',
  },
  roles: [
    { key: 'admin-lab' as const, name: 'Admin Lab' },
    { key: 'guru' as const, name: 'Guru' },
  ],
  createdAt: '2026-09-03T01:00:00.000Z',
  updatedAt: '2026-09-03T02:00:00.000Z',
};

const role = {
  key: 'admin-lab' as const,
  name: 'Admin Lab',
  permissions: ['roles.view', 'users.create', 'users.update', 'users.view'],
  membershipCount: 3,
  activeMembershipCount: 2,
};

function clientWith(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: [role] })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: membership })) as ApiClient['post'],
    put: vi.fn(async () => undefined) as ApiClient['put'],
    patch: vi.fn(async () => ({ data: membership })) as ApiClient['patch'],
    delete: vi.fn(async () => undefined) as ApiClient['delete'],
    ...overrides,
  };
}

describe('Identity administration response parsing', () => {
  it('parses exact membership and pagination projections', () => {
    expect(parseIdentityMembership(membership)).toEqual(membership);
    expect(parseIdentityMembershipPage({
      data: [membership],
      meta: { page: 1, perPage: 25, total: 1, lastPage: 1 },
    })).toEqual({
      data: [membership],
      meta: { page: 1, perPage: 25, total: 1, lastPage: 1 },
    });
  });

  it.each([
    { ...membership, password: 'forbidden' },
    { ...membership, status: 'deleted' },
    { ...membership, roles: [...membership.roles, membership.roles[0]] },
    { ...membership, user: { ...membership.user, status: 'blocked' } },
    { ...membership, user: { ...membership.user, lastLoginAt: 'not-a-date' } },
  ])('rejects malformed or over-broad membership projections', (value) => {
    expect(() => parseIdentityMembership(value)).toThrow(IdentityAdminContractError);
  });

  it('requires exact paginated envelopes', () => {
    expect(() => parseIdentityMembershipPage({ data: [membership] })).toThrow(IdentityAdminContractError);
    expect(() => parseIdentityMembershipPage({
      data: [membership],
      meta: { page: 0, perPage: 25, total: 1, lastPage: 1 },
    })).toThrow(IdentityAdminContractError);
  });

  it('parses sorted canonical role permissions and rejects unsorted/unknown role data', () => {
    expect(parseIdentityRoleCollection({ data: [role] })).toEqual([role]);
    expect(() => parseIdentityRoleCollection({ data: [{ ...role, permissions: ['users.view', 'roles.view'] }] }))
      .toThrow(IdentityAdminContractError);
    expect(() => parseIdentityRoleCollection({ data: [{ ...role, key: 'custom-admin' }] }))
      .toThrow(IdentityAdminContractError);
  });
});

describe('Identity administration gateway boundary', () => {
  it('uses exact tenant identity endpoints, filters, and encoded IDs', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === '/identity/roles') return { data: [role] };
      if (path.startsWith('/identity/memberships?')) {
        return { data: [membership], meta: { page: 2, perPage: 25, total: 30, lastPage: 2 } };
      }
      return { data: membership };
    });
    const post = vi.fn(async () => ({ data: membership }));
    const patch = vi.fn(async () => ({ data: membership }));
    const gateway = createIdentityAdminGateway(clientWith({
      get: get as ApiClient['get'],
      post: post as ApiClient['post'],
      patch: patch as ApiClient['patch'],
    }));

    const createInput: CreateIdentityMembershipInput = {
      name: 'Admin SmartLab',
      email: 'admin@example.test',
      password: 'VerySafePass123!',
      nip: null,
      nis: null,
      phone: null,
      roleKeys: ['admin-lab'],
    };

    await gateway.listMemberships({ search: ' admin ', status: 'active', roleKey: 'admin-lab', page: 2, perPage: 25 });
    await gateway.showMembership('member/id with spaces');
    await gateway.createMembership(createInput);
    await gateway.updateMembership('member/id with spaces', { roleKeys: ['guru'] });
    await gateway.listRoles();

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/identity/memberships?search=admin&status=active&roleKey=admin-lab&page=2&perPage=25',
      '/identity/memberships/member%2Fid%20with%20spaces',
      '/identity/roles',
    ]);
    expect(post).toHaveBeenCalledWith('/identity/memberships', createInput);
    expect(patch).toHaveBeenCalledWith('/identity/memberships/member%2Fid%20with%20spaces', { roleKeys: ['guru'] });
    expect('deleteMembership' in gateway).toBe(false);
    expect('resetPassword' in gateway).toBe(false);
    expect('updateRolePermissions' in gateway).toBe(false);
  });

  it('rejects unsafe empty identifiers and empty updates', async () => {
    const gateway = createIdentityAdminGateway(clientWith());
    await expect(gateway.showMembership('   ')).rejects.toThrow(IdentityAdminContractError);
    await expect(gateway.updateMembership('valid-id', {})).rejects.toThrow(IdentityAdminContractError);
  });
});
