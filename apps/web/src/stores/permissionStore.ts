import { create } from 'zustand';
import {
  createDefaultPermissionMatrix,
  sanitizePermissionMatrix,
  type ModuleKey,
  type PermissionAction,
  type PermissionMatrix,
  type RoleName,
} from '@/lib/permissions';
import { readStorage, STORAGE_KEYS, writeStorage } from '@/lib/storage';

interface PermissionState {
  permissions: PermissionMatrix;
  setPermissions: (permissions: PermissionMatrix) => void;
  updatePermission: (role: RoleName, module: ModuleKey, action: PermissionAction, enabled: boolean) => void;
  resetRole: (role: RoleName) => void;
  resetAll: () => void;
}

function loadPermissions(): PermissionMatrix {
  return sanitizePermissionMatrix(readStorage<unknown>(STORAGE_KEYS.ROLE_PERMS, null));
}

function persistPermissions(permissions: PermissionMatrix) {
  writeStorage(STORAGE_KEYS.ROLE_PERMS, permissions);
}

export const usePermissionStore = create<PermissionState>((set) => ({
  permissions: loadPermissions(),
  setPermissions: (permissions) => {
    const next = sanitizePermissionMatrix(permissions);
    persistPermissions(next);
    set({ permissions: next });
  },
  updatePermission: (role, module, action, enabled) => {
    set((state) => {
      const next = sanitizePermissionMatrix(state.permissions);
      const actions = next[role][module];
      next[role][module] = enabled
        ? [...new Set([...actions, action])]
        : actions.filter((currentAction) => currentAction !== action);
      persistPermissions(next);
      return { permissions: next };
    });
  },
  resetRole: (role) => {
    set((state) => {
      const next = sanitizePermissionMatrix(state.permissions);
      const defaults = createDefaultPermissionMatrix();
      next[role] = defaults[role];
      persistPermissions(next);
      return { permissions: next };
    });
  },
  resetAll: () => {
    const next = createDefaultPermissionMatrix();
    persistPermissions(next);
    set({ permissions: next });
  },
}));

