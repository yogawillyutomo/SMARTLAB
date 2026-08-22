import { ROLE_NAMES } from '@/lib/permissions';
import type { AuthenticatedUser, RoleName } from '@/types';
import type { CurrentUserPayload } from '@/services/authApi';

export class UnsupportedRoleError extends Error {
  constructor() {
    super('Tidak ada role server yang dikenali oleh antarmuka saat ini.');
    this.name = 'UnsupportedRoleError';
  }
}

function isRecognizedRole(role: string): role is RoleName {
  return (ROLE_NAMES as readonly string[]).includes(role);
}

/** Uses the first recognized role in the server-provided order; never invents a fallback role. */
export function derivePrimaryRole(roles: readonly string[]): RoleName | null {
  return roles.find(isRecognizedRole) ?? null;
}

export function toAuthenticatedUser(payload: CurrentUserPayload): AuthenticatedUser {
  const role = derivePrimaryRole(payload.membership.roles);
  if (!role) throw new UnsupportedRoleError();

  return {
    id: payload.id,
    name: payload.name,
    email: payload.email,
    school: { ...payload.school },
    membership: {
      ...payload.membership,
      roles: [...payload.membership.roles],
    },
    permissions: [...payload.permissions],
    role,
  };
}

/** Exact backend permission check for API-migrated capabilities. */
export function hasServerPermission(user: AuthenticatedUser | null, permission: string): boolean {
  return Boolean(user && user.permissions.includes(permission));
}
