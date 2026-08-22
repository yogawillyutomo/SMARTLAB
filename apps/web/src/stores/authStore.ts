import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StateCreator } from 'zustand';
import { ApiClientError } from '@/lib/apiClient';
import { clearLegacyAuthStorage } from '@/lib/authStorage';
import { toAuthenticatedUser, UnsupportedRoleError } from '@/lib/authIdentity';
import { authGateway, type AuthGateway } from '@/services/authApi';
import type { AuthenticatedUser } from '@/types';

export type AuthStatus =
  | 'bootstrapping'
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'logging_out'
  | 'context_error'
  | 'error';

export interface AuthIssue {
  code: string;
  message: string;
  status?: number;
  errors?: Record<string, string[]>;
  retryAfter?: number;
  retryable: boolean;
}

export type AuthActionResult = { ok: true } | { ok: false; issue: AuthIssue };

export interface AuthState {
  user: AuthenticatedUser | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  issue: AuthIssue | null;
  bootstrapSession: (options?: { force?: boolean }) => Promise<void>;
  login: (email: string, password: string, remember: boolean) => Promise<AuthActionResult>;
  logout: () => Promise<AuthActionResult>;
}

interface AuthDependencies {
  gateway: AuthGateway;
  clearLegacyAuth: () => void;
}

const CONTEXT_ERROR_CODES = new Set(['ACTIVE_MEMBERSHIP_REQUIRED', 'SCHOOL_CONTEXT_REQUIRED', 'UNSUPPORTED_ROLE']);
const ORDINARY_UNAUTHENTICATED_CODES = new Set([
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'VALIDATION_FAILED',
  'TOO_MANY_LOGIN_ATTEMPTS',
]);

export function toAuthIssue(error: unknown): AuthIssue {
  if (error instanceof UnsupportedRoleError) {
    return {
      code: 'UNSUPPORTED_ROLE',
      message: error.message,
      retryable: false,
    };
  }

  if (error instanceof ApiClientError) {
    if (error.kind === 'network' || (error.status !== undefined && error.status >= 500)) {
      return {
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Layanan autentikasi tidak dapat dijangkau.',
        status: error.status,
        retryable: true,
      };
    }

    if (error.status === 419) {
      return {
        code: 'CSRF_RETRY_FAILED',
        message: 'Sesi keamanan tidak dapat diperbarui.',
        status: error.status,
        retryable: true,
      };
    }

    if (error.kind === 'api' && error.code) {
      return {
        code: error.code,
        message: error.message,
        status: error.status,
        errors: error.errors,
        retryAfter: error.retryAfter,
        retryable: CONTEXT_ERROR_CODES.has(error.code) || !ORDINARY_UNAUTHENTICATED_CODES.has(error.code),
      };
    }

    return {
      code: 'UNEXPECTED_RESPONSE',
      message: error.message,
      status: error.status,
      retryable: true,
    };
  }

  return {
    code: 'UNEXPECTED_RESPONSE',
    message: 'Respons layanan autentikasi tidak dapat diproses.',
    retryable: true,
  };
}

function statusForIssue(issue: AuthIssue): AuthStatus {
  if (CONTEXT_ERROR_CODES.has(issue.code)) return 'context_error';
  if (ORDINARY_UNAUTHENTICATED_CODES.has(issue.code)) return 'unauthenticated';
  return 'error';
}

export function createAuthState({ gateway, clearLegacyAuth }: AuthDependencies): StateCreator<AuthState> {
  let bootstrapInFlight: Promise<void> | null = null;
  let loginInFlight: Promise<AuthActionResult> | null = null;
  let logoutInFlight: Promise<AuthActionResult> | null = null;
  let legacyStorageCleared = false;

  function clearLegacyAuthOnce(): void {
    if (legacyStorageCleared) return;
    legacyStorageCleared = true;
    clearLegacyAuth();
  }

  return (set, get) => ({
    user: null,
    status: 'bootstrapping',
    isAuthenticated: false,
    issue: null,

    bootstrapSession(options) {
      if (bootstrapInFlight) return bootstrapInFlight;
      if (get().status === 'authenticated' && !options?.force) return Promise.resolve();

      clearLegacyAuthOnce();
      set({ user: null, status: 'bootstrapping', isAuthenticated: false, issue: null });

      const task = (async () => {
        try {
          const user = toAuthenticatedUser(await gateway.getCurrentUser());
          set({ user, status: 'authenticated', isAuthenticated: true, issue: null });
        } catch (error) {
          const issue = toAuthIssue(error);
          set({
            user: null,
            status: statusForIssue(issue),
            isAuthenticated: false,
            issue: issue.code === 'UNAUTHENTICATED' ? null : issue,
          });
        }
      })();

      bootstrapInFlight = task;
      void task.finally(() => {
        if (bootstrapInFlight === task) bootstrapInFlight = null;
      });
      return task;
    },

    login(email, password, remember) {
      if (loginInFlight) return loginInFlight;
      clearLegacyAuthOnce();
      set({ user: null, status: 'authenticating', isAuthenticated: false, issue: null });

      const task = (async (): Promise<AuthActionResult> => {
        try {
          await gateway.login(email, password, remember);
          const user = toAuthenticatedUser(await gateway.getCurrentUser());
          set({ user, status: 'authenticated', isAuthenticated: true, issue: null });
          return { ok: true };
        } catch (error) {
          const issue = toAuthIssue(error);
          set({ user: null, status: statusForIssue(issue), isAuthenticated: false, issue });
          return { ok: false, issue };
        }
      })();

      loginInFlight = task;
      void task.finally(() => {
        if (loginInFlight === task) loginInFlight = null;
      });
      return task;
    },

    logout() {
      if (logoutInFlight) return logoutInFlight;
      clearLegacyAuthOnce();
      const currentUser = get().user;
      set({ status: 'logging_out', isAuthenticated: Boolean(currentUser), issue: null });

      const task = (async (): Promise<AuthActionResult> => {
        try {
          await gateway.logout();
          set({ user: null, status: 'unauthenticated', isAuthenticated: false, issue: null });
          return { ok: true };
        } catch (error) {
          const issue = toAuthIssue(error);
          if (issue.code === 'UNAUTHENTICATED') {
            set({ user: null, status: 'unauthenticated', isAuthenticated: false, issue: null });
            return { ok: true };
          }

          set({
            user: currentUser,
            status: currentUser ? 'authenticated' : statusForIssue(issue),
            isAuthenticated: Boolean(currentUser),
            issue,
          });
          return { ok: false, issue };
        }
      })();

      logoutInFlight = task;
      void task.finally(() => {
        if (logoutInFlight === task) logoutInFlight = null;
      });
      return task;
    },
  });
}

const defaultDependencies: AuthDependencies = {
  gateway: authGateway,
  clearLegacyAuth: clearLegacyAuthStorage,
};

export const useAuthStore = create<AuthState>(createAuthState(defaultDependencies));

export function createAuthStoreForTesting(dependencies: AuthDependencies) {
  return createStore<AuthState>(createAuthState(dependencies));
}
