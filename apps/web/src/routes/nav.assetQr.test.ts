import { describe, expect, it } from 'vitest';
import { canViewNavigationItem, NAV_GROUPS } from '@/routes/nav';
import type { PermissionMatrix } from '@/lib/permissions';
import type { AuthenticatedUser } from '@/types';

function userWithPermissions(permissions: string[]): AuthenticatedUser {
  return {
    permissions,
  } as AuthenticatedUser;
}

const matrix = {} as PermissionMatrix;
const qrItem = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.to === '/assets/qr-labels');

describe('Asset QR navigation boundary', () => {
  it('requires both Asset view and label generation permissions', () => {
    expect(qrItem).toBeDefined();
    if (!qrItem) throw new Error('Asset QR navigation item missing.');

    expect(canViewNavigationItem(matrix, userWithPermissions([]), qrItem)).toBe(false);
    expect(canViewNavigationItem(matrix, userWithPermissions(['assets.view']), qrItem)).toBe(false);
    expect(canViewNavigationItem(matrix, userWithPermissions(['assets.generate-labels']), qrItem)).toBe(false);
    expect(canViewNavigationItem(matrix, userWithPermissions(['assets.view', 'assets.generate-labels']), qrItem)).toBe(true);
  });
});
