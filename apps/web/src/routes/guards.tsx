import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { canView, type ModuleKey } from '@/lib/permissions';
import { usePermissionStore } from '@/stores/permissionStore';
import { authIssueMessage } from '@/lib/authMessages';

function SessionState({ context = false }: { context?: boolean }) {
  const issue = useAuthStore((state) => state.issue);
  const bootstrapSession = useAuthStore((state) => state.bootstrapSession);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-900 px-6 text-center">
      <div>
        <h1 className="text-lg font-bold text-ink-primary">
          {context ? 'Konteks akun belum dapat digunakan' : 'Layanan autentikasi tidak tersedia'}
        </h1>
        <p className="mt-2 max-w-md text-sm text-ink-muted">{authIssueMessage(issue)}</p>
      </div>
      {issue?.retryable && (
        <button
          type="button"
          onClick={() => void bootstrapSession()}
          className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-semibold text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Coba lagi
        </button>
      )}
      {context && (
        <Link
          to="/login"
          className="text-sm font-medium text-accent-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Kembali ke halaman masuk
        </Link>
      )}
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, status } = useAuthStore();
  const location = useLocation();
  if (status === 'bootstrapping') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base-900 text-sm text-ink-muted">
        Memuat sesi...
      </div>
    );
  }
  if (status === 'error') return <SessionState />;
  if (status === 'context_error') return <SessionState context />;
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export function RequirePermission({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { user } = useAuthStore();
  const permissions = usePermissionStore((s) => s.permissions);
  if (!user || !canView(permissions, user.role, module)) {
    return <NoAccess />;
  }
  return <>{children}</>;
}

export function NoAccess() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-danger/15 text-danger">
        <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h2 className="text-lg font-bold text-ink-primary">Akses Ditolak</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">
        Role Anda tidak memiliki izin untuk mengakses halaman ini. Silakan hubungi administrator.
      </p>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-7xl font-bold text-accent-content">404</p>
      <h2 className="mt-4 text-xl font-bold text-ink-primary">Halaman tidak ditemukan</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">URL yang Anda akses tidak tersedia atau telah dipindahkan.</p>
      <a href="/dashboard" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm font-semibold text-accent-foreground hover:brightness-110">
        Kembali ke Dashboard
      </a>
    </div>
  );
}
