import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { useUIStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppData } from '@/hooks/useAppData';

export function AppLayout() {
  const location = useLocation();
  const { hydrate: hydrateUI } = useUIStore();
  const { hydrate: hydrateAuth, isAuthenticated } = useAuthStore();
  const { db } = useAppData();

  useEffect(() => {
    hydrateUI();
    hydrateAuth(db.users);
  }, [hydrateUI, hydrateAuth, db.users]);

  useEffect(() => {
    if (!isAuthenticated) {
      // Let auth hydrate first; redirect handled by guard
    }
  }, [isAuthenticated]);

  // Scroll to top on route change
  useEffect(() => {
    const main = document.getElementById('app-main');
    if (main) main.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-base-900">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main id="app-main" className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
