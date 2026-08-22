import { describe, expect, it } from 'vitest';
import { derivePrimaryRole, hasServerPermission, toAuthenticatedUser, UnsupportedRoleError } from '@/lib/authIdentity';
import { isSafeInternalPath, postLoginPath } from '@/lib/authNavigation';
import { getVisibleNavGroupsForUser, getVisibleNavItemsForUser } from '@/routes/nav';
import { createDefaultPermissionMatrix } from '@/lib/permissions';
import type { CurrentUserPayload } from '@/services/authApi';
import type { AuthenticatedUser } from '@/types';

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

describe('dynamic navigation topology with server-authoritative Laboratory access', () => {
  function navigationUser(serverPermissions: string[]): AuthenticatedUser {
    return {
      ...toAuthenticatedUser(payload),
      permissions: serverPermissions,
      role: 'Admin Lab',
    };
  }

  function navigationItems(
    sessions: boolean,
    journals: boolean,
    localLaboratory: boolean,
    serverPermissions: string[] = [],
  ) {
    const permissions = createDefaultPermissionMatrix();
    permissions['Admin Lab'].sessions = sessions ? ['view'] : [];
    permissions['Admin Lab'].journals = journals ? ['view'] : [];
    permissions['Admin Lab'].laboratories = localLaboratory ? ['view'] : [];
    const user = navigationUser(serverPermissions);

    return {
      sidebar: getVisibleNavGroupsForUser(permissions, user).flatMap((group) => group.items),
      global: getVisibleNavItemsForUser(permissions, user),
    };
  }

  it('preserves the journals-only shortcut in sidebar and global page items', () => {
    const items = navigationItems(false, true, false);

    for (const navigation of [items.sidebar, items.global]) {
      expect(navigation).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Riwayat & Laporan', to: '/journals' }),
      ]));
    }
  });

  it('keeps the normal session route without an independent journal shortcut', () => {
    const items = navigationItems(true, true, false);

    for (const navigation of [items.sidebar, items.global]) {
      expect(navigation.filter(({ label }) => label === 'Pelaksanaan Lab')).toHaveLength(1);
      expect(navigation.filter(({ label }) => label === 'Riwayat & Laporan')).toHaveLength(0);
    }
  });

  it('hides Laboratory when only the local role matrix grants access', () => {
    const items = navigationItems(true, true, true);

    for (const navigation of [items.sidebar, items.global]) {
      expect(navigation.some(({ module }) => module === 'laboratories')).toBe(false);
    }
  });

  it('shows Laboratory from exact server permission without a local-role fallback', () => {
    const items = navigationItems(true, true, false, ['laboratories.view']);

    for (const navigation of [items.sidebar, items.global]) {
      expect(navigation.filter(({ module }) => module === 'laboratories')).toHaveLength(1);
    }
  });
});
