import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { can, type ModuleKey, type PermissionAction } from '@/lib/permissions';
import { usePermissionStore } from '@/stores/permissionStore';

export function PermissionGuard({ module, action = 'view', children, fallback = null }: { module: ModuleKey; action?: PermissionAction; children: ReactNode; fallback?: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const permissions = usePermissionStore((s) => s.permissions);
  if (!user || !can(permissions, user.role, module, action)) return <>{fallback}</>;
  return <>{children}</>;
}

export function RoleGuard({ roles, children, fallback = null }: { roles: string[]; children: ReactNode; fallback?: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user || !roles.includes(user.role)) return <>{fallback}</>;
  return <>{children}</>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Permission hooks stay next to the guards that expose the same permission behavior.
export function usePermission(module: ModuleKey, action: PermissionAction = 'view'): boolean {
  const user = useAuthStore((s) => s.user);
  const permissions = usePermissionStore((s) => s.permissions);
  return user ? can(permissions, user.role, module, action) : false;
}
