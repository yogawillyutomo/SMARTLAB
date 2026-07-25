import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { canView, type ModuleKey } from '@/lib/permissions';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export function RequirePermission({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { user } = useAuthStore();
  if (!user || !canView(user.role, module)) {
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
        Role Anda tidak memiliki izin untuk mengakses halaman ini. Silakan hubungi administrator atau ganti role melalui menu profil.
      </p>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-7xl font-bold text-accent-blue">404</p>
      <h2 className="mt-4 text-xl font-bold text-ink-primary">Halaman tidak ditemukan</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">URL yang Anda akses tidak tersedia atau telah dipindahkan.</p>
      <a href="/dashboard" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
        Kembali ke Dashboard
      </a>
    </div>
  );
}
