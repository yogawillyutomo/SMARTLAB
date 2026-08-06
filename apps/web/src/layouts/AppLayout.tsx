import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { useAppData } from '@/hooks/useAppData';

export function AppLayout() {
  const location = useLocation();
  const { recovery, storageHealth } = useAppData();

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
        {recovery && <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-foreground">Database asli sedang dipertahankan karena migrasi gagal. Tampilan ini memakai data sementara dan perubahan tidak dapat disimpan. Impor backup valid atau reset database secara sengaja.</div>}
        {!recovery && storageHealth.warnings.length > 0 && <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-foreground">Database dapat digunakan, tetapi versi penyimpanan belum dapat diperiksa atau diperbarui. Aplikasi akan mencoba kembali saat dimuat ulang.</div>}
        <main id="app-main" className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
