import { create } from 'zustand';
import type { RoleName, User } from '@/types';
import { readStorage, writeStorage, STORAGE_KEYS } from '@/lib/storage';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string, users: User[]) => { ok: boolean; error?: string };
  loginAs: (user: User) => void;
  switchRole: (role: RoleName, users: User[]) => void;
  logout: () => void;
  hydrate: (users: User[]) => void;
}

interface PersistedAuth {
  userId: string | null;
}

function loadAuth(): PersistedAuth {
  return readStorage<PersistedAuth>(STORAGE_KEYS.AUTH, { userId: null });
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  login(email, password, users) {
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
    writeStorage(STORAGE_KEYS.AUTH, { userId: user.id });
    set({ user: updated, isAuthenticated: true });
    return { ok: true };
  },
  loginAs(user) {
    writeStorage(STORAGE_KEYS.AUTH, { userId: user.id });
    set({ user, isAuthenticated: true });
  },
  switchRole(role, users) {
    // Find a user with that role, fallback to keeping current with role changed
    set((state) => {
      if (!state.user) return state;
      const candidate = users.find((u) => u.role === role);
      const newUser = candidate ?? { ...state.user, role };
      writeStorage(STORAGE_KEYS.AUTH, { userId: newUser.id });
      return { user: newUser, isAuthenticated: true };
    });
  },
  logout() {
    writeStorage(STORAGE_KEYS.AUTH, { userId: null });
    set({ user: null, isAuthenticated: false });
  },
  hydrate(users) {
    const { userId } = loadAuth();
    if (userId) {
      const user = users.find((u) => u.id === userId);
      if (user) {
        set({ user, isAuthenticated: true });
        return;
      }
    }
    set({ user: null, isAuthenticated: false });
  },
}));
