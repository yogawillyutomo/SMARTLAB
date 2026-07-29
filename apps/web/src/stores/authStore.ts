import { create } from 'zustand';
import type { RoleName, User } from '@/types';
import {
  readSessionStorage,
  readStorage,
  removeSessionStorage,
  removeStorage,
  writeSessionStorage,
  writeStorage,
  STORAGE_KEYS,
} from '@/lib/storage';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  remember: boolean;
  login: (email: string, password: string, users: User[], remember: boolean) => { ok: boolean; error?: string };
  loginAs: (user: User, remember: boolean) => void;
  switchRole: (role: RoleName, users: User[]) => void;
  logout: () => void;
  hydrate: (users: User[]) => void;
}

interface PersistedAuth {
  userId: string | null;
}

function clearPersistedAuth(): void {
  removeStorage(STORAGE_KEYS.AUTH);
  removeSessionStorage(STORAGE_KEYS.AUTH);
}

function persistAuth(userId: string, remember: boolean): void {
  clearPersistedAuth();
  const auth = { userId };
  if (remember) {
    writeStorage(STORAGE_KEYS.AUTH, auth);
  } else {
    writeSessionStorage(STORAGE_KEYS.AUTH, auth);
  }
}

function loadAuth(): { persisted: PersistedAuth; remember: boolean } {
  const local = readStorage<PersistedAuth | null>(STORAGE_KEYS.AUTH, null);
  if (local?.userId) return { persisted: local, remember: true };

  const session = readSessionStorage<PersistedAuth | null>(STORAGE_KEYS.AUTH, null);
  if (session?.userId) return { persisted: session, remember: false };

  return { persisted: { userId: null }, remember: true };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isHydrated: false,
  remember: true,
  login(email, password, users, remember) {
    if (password !== 'password') {
      return { ok: false, error: 'Password salah. Gunakan password: password' };
    }
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return { ok: false, error: 'Email tidak ditemukan. Coba akun demo.' };
    }
    if (user.status !== 'active') {
      return { ok: false, error: 'Akun nonaktif. Hubungi admin.' };
    }
    const updated = { ...user, lastLogin: new Date().toISOString() };
    persistAuth(user.id, remember);
    set({ user: updated, isAuthenticated: true, isHydrated: true, remember });
    return { ok: true };
  },
  loginAs(user, remember) {
    persistAuth(user.id, remember);
    set({ user, isAuthenticated: true, isHydrated: true, remember });
  },
  switchRole(role, users) {
    // Find a user with that role, fallback to keeping current with role changed
    set((state) => {
      if (!state.user) return state;
      const candidate = users.find((u) => u.role === role);
      const newUser = candidate ?? { ...state.user, role };
      persistAuth(newUser.id, state.remember);
      return { user: newUser, isAuthenticated: true, isHydrated: true };
    });
  },
  logout() {
    clearPersistedAuth();
    set({ user: null, isAuthenticated: false, isHydrated: true, remember: true });
  },
  hydrate(users) {
    const { persisted, remember } = loadAuth();
    const { userId } = persisted;
    if (userId) {
      const user = users.find((u) => u.id === userId);
      if (user) {
        set({ user, isAuthenticated: true, isHydrated: true, remember });
        return;
      }
    }
    set({ user: null, isAuthenticated: false, isHydrated: true, remember: true });
  },
}));
