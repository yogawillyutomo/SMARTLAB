import { describe, expect, it } from 'vitest';
import { derivePrimaryRole, hasServerPermission, toAuthenticatedUser, UnsupportedRoleError } from '@/lib/authIdentity';
import { isSafeInternalPath, postLoginPath } from '@/lib/authNavigation';
import type { CurrentUserPayload } from '@/services/authApi';

const payload: CurrentUserPayload = {
  id: '01TEST',
  name: 'SmartLab Admin',
  email: 'admin@example.test',
  school: { id: '01SCHOOL', code: 'SMK-01', name: 'SMK SmartLab' },
  membership: { id: '01MEMBER', status: 'active', roles: ['Admin Lab', 'Guru'] },
  permissions: ['assets.view', 'laboratories.view'],
};

describe('server identity compatibility boundary', () => {
  it('uses the first recognized server role deterministically and preserves all identity context', () => {
    expect(derivePrimaryRole(['Unknown Role', 'Guru', 'Admin Lab'])).toBe('Guru');
    const user = toAuthenticatedUser(payload);
    expect(user.role).toBe('Admin Lab');
    expect(user.membership.roles).toEqual(['Admin Lab', 'Guru']);
    expect(user.permissions).toEqual(['assets.view', 'laboratories.view']);
    expect(user.school).toEqual(payload.school);
    expect(user.membership.id).toBe('01MEMBER');
  });

  it('fails closed when no server role is recognized', () => {
    expect(derivePrimaryRole(['External Auditor'])).toBeNull();
    expect(() => toAuthenticatedUser({
      ...payload,
      membership: { ...payload.membership, roles: ['External Auditor'] },
    })).toThrow(UnsupportedRoleError);
  });

  it('checks exact server permission keys without prefix or case fallback', () => {
    const user = toAuthenticatedUser(payload);
    expect(hasServerPermission(user, 'assets.view')).toBe(true);
    expect(hasServerPermission(user, 'assets')).toBe(false);
    expect(hasServerPermission(user, 'ASSETS.VIEW')).toBe(false);
  });
});

describe('protected deep-link navigation', () => {
  it('restores a safe requested route with its query and hash', () => {
    expect(postLoginPath({ from: { pathname: '/monitoring/device-1', search: '?tab=health', hash: '#cpu' } }))
      .toBe('/monitoring/device-1?tab=health#cpu');
  });

  it('rejects external, protocol-relative, backslash, control-character, and login redirects', () => {
    for (const pathname of ['https://evil.test', '//evil.test', '/\\evil.test', `/safe${String.fromCharCode(10)}evil`, '/login']) {
      expect(postLoginPath({ from: { pathname } })).toBe('/dashboard');
    }
    expect(isSafeInternalPath('/dashboard')).toBe(true);
  });
});
