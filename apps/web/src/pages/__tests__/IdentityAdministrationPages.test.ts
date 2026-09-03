import { describe, expect, it } from 'vitest';
import appSource from '@/App.tsx?raw';
import navSource from '@/routes/nav.ts?raw';
import usersSource from '@/pages/UsersPage.tsx?raw';
import rolesSource from '@/pages/RolesPage.tsx?raw';

describe('identity administration production boundaries', () => {
  it('guards Pengguna and Hak Akses with exact server permissions', () => {
    expect(appSource).toContain('permission="users.view"><UsersPage');
    expect(appSource).toContain('permission="roles.view"><RolesPage');
    expect(appSource).not.toContain('module="users"><UsersPage');
    expect(appSource).not.toContain('module="roles"><RolesPage');

    expect(navSource).toContain("serverPermission: 'users.view'");
    expect(navSource).toContain("serverPermission: 'roles.view'");
  });

  it('keeps the Pengguna page entirely off browser-local business authority', () => {
    expect(usersSource).toContain("from '@/services/identityAdminApi'");
    expect(usersSource).toContain("hasServerPermission(user, 'users.create')");
    expect(usersSource).toContain("hasServerPermission(user, 'users.update')");
    expect(usersSource).not.toContain('useAppData');
    expect(usersSource).not.toContain('services/repositories');
    expect(usersSource).not.toContain('usePermissionStore');
    expect(usersSource).not.toContain("usePermission('users'");
    expect(usersSource).not.toContain('resetPassword');
    expect(usersSource).not.toContain('Password ${');
  });

  it('makes Hak Akses a read-only server catalog rather than a local permission editor', () => {
    expect(rolesSource).toContain("from '@/services/identityAdminApi'");
    expect(rolesSource).toContain('Server-authoritative · read-only');
    expect(rolesSource).not.toContain('useAppData');
    expect(rolesSource).not.toContain('usePermissionStore');
    expect(rolesSource).not.toContain('services/repositories');
    expect(rolesSource).not.toContain('setPermissions');
    expect(rolesSource).not.toContain('resetAll');
    expect(rolesSource).not.toContain('auditLog');
  });
});
