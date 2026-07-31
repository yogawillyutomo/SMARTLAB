import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { AppTopbar } from '@/components/layout/AppTopbar';

export function AppLayout() {
  const location = useLocation();

  // Scroll to top on route change
  useEffect(() => {
    const main = document.getElementById('app-main');
    if (main) main.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="print-content flex h-screen min-w-0 overflow-hidden bg-base-900">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main id="app-main" className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
