import { useEffect, useRef } from 'react';
import { createBrowserRouter, Navigate, Route, RouterProvider, Routes } from 'react-router-dom';
import { AppDataProvider } from '@/hooks/useAppData';
import { AppLayout } from '@/layouts/AppLayout';
import { RequireAuth, RequirePermission, NotFoundPage } from '@/routes/guards';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { MonitoringPage } from '@/pages/MonitoringPage';
import { Toaster } from '@/components/ui/Toaster';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { useAppData } from '@/hooks/useAppData';

// Pages
import { LaboratoriesPage, LaboratoryDetailPage, LaboratoryLayoutPage } from '@/pages/LaboratoriesPage';
import { SchedulesPage } from '@/pages/SchedulesPage';
import { BookingsPage } from '@/pages/BookingsPage';
import { SessionsPage } from '@/pages/SessionsPage';
import { JournalsPage } from '@/pages/JournalsPage';
import { AssetsPage, AssetDetailPage } from '@/pages/AssetsPage';
import { StockPage } from '@/pages/StockPage';
import { IncidentsPage } from '@/pages/IncidentsPage';
import { WorkOrdersPage } from '@/pages/WorkOrdersPage';
import { MaintenancePage } from '@/pages/MaintenancePage';
import { LoansPage } from '@/pages/LoansPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { UsersPage } from '@/pages/UsersPage';
import { RolesPage } from '@/pages/RolesPage';
import { MasterDataPage } from '@/pages/MasterDataPage';
import { AuditLogsPage } from '@/pages/AuditLogsPage';
import { SettingsPage } from '@/pages/SettingsPage';

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<RequirePermission module="dashboard"><DashboardPage /></RequirePermission>} />
        <Route path="/laboratories" element={<RequirePermission module="laboratories"><LaboratoriesPage /></RequirePermission>} />
        <Route path="/laboratories/:id" element={<RequirePermission module="laboratories"><LaboratoryDetailPage /></RequirePermission>} />
        <Route path="/laboratories/:id/layout" element={<RequirePermission module="laboratories"><LaboratoryLayoutPage /></RequirePermission>} />
        <Route path="/schedules" element={<RequirePermission module="schedules"><SchedulesPage /></RequirePermission>} />
        <Route path="/bookings" element={<RequirePermission module="bookings"><BookingsPage /></RequirePermission>} />
        <Route path="/sessions" element={<RequirePermission module="sessions"><SessionsPage /></RequirePermission>} />
        <Route path="/sessions/:id" element={<RequirePermission module="sessions"><SessionsPage /></RequirePermission>} />
        <Route path="/journals" element={<RequirePermission module="journals"><JournalsPage /></RequirePermission>} />
        <Route path="/journals/:id" element={<RequirePermission module="journals"><JournalsPage /></RequirePermission>} />
        <Route path="/monitoring" element={<RequirePermission module="monitoring"><MonitoringPage /></RequirePermission>} />
        <Route path="/monitoring/:deviceId" element={<RequirePermission module="monitoring"><MonitoringPage /></RequirePermission>} />
        <Route path="/assets" element={<RequirePermission module="assets"><AssetsPage /></RequirePermission>} />
        <Route path="/assets/:id" element={<RequirePermission module="assets"><AssetDetailPage /></RequirePermission>} />
        <Route path="/stock" element={<RequirePermission module="stock"><StockPage /></RequirePermission>} />
        <Route path="/incidents" element={<RequirePermission module="incidents"><IncidentsPage /></RequirePermission>} />
        <Route path="/incidents/:id" element={<RequirePermission module="incidents"><IncidentsPage /></RequirePermission>} />
        <Route path="/work-orders" element={<RequirePermission module="work-orders"><WorkOrdersPage /></RequirePermission>} />
        <Route path="/work-orders/:id" element={<RequirePermission module="work-orders"><WorkOrdersPage /></RequirePermission>} />
        <Route path="/maintenance" element={<RequirePermission module="maintenance"><MaintenancePage /></RequirePermission>} />
        <Route path="/loans" element={<RequirePermission module="loans"><LoansPage /></RequirePermission>} />
        <Route path="/calendar" element={<RequirePermission module="calendar"><CalendarPage /></RequirePermission>} />
        <Route path="/reports" element={<RequirePermission module="reports"><ReportsPage /></RequirePermission>} />
        <Route path="/notifications" element={<RequirePermission module="notifications"><NotificationsPage /></RequirePermission>} />
        <Route path="/users" element={<RequirePermission module="users"><UsersPage /></RequirePermission>} />
        <Route path="/roles" element={<RequirePermission module="roles"><RolesPage /></RequirePermission>} />
        <Route path="/master-data" element={<RequirePermission module="master-data"><MasterDataPage /></RequirePermission>} />
        <Route path="/audit-logs" element={<RequirePermission module="audit-logs"><AuditLogsPage /></RequirePermission>} />
        <Route path="/settings" element={<RequirePermission module="settings"><SettingsPage /></RequirePermission>} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

const appRouter = createBrowserRouter([{ path: '*', element: <AppRoutes /> }]);

function AppBootstrap() {
  const { db, ready } = useAppData();
  const hydrateAuth = useAuthStore((state) => state.hydrate);
  const isAuthHydrated = useAuthStore((state) => state.isHydrated);
  const hydrateUI = useUIStore((state) => state.hydrate);
  const isUIHydrated = useUIStore((state) => state.isHydrated);
  const hydrationStarted = useRef(false);

  useEffect(() => {
    if (hydrationStarted.current || isUIHydrated) return;
    hydrationStarted.current = true;
    hydrateUI();
  }, [hydrateUI, isUIHydrated]);

  useEffect(() => {
    if (!isUIHydrated) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => useUIStore.getState().syncSystemTheme();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [isUIHydrated]);

  useEffect(() => {
    if (ready && !isAuthHydrated) {
      hydrateAuth(db.users);
    }
  }, [db.users, hydrateAuth, isAuthHydrated, ready]);

  if (!ready || !isAuthHydrated || !isUIHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base-900 text-sm text-ink-muted">
        Memuat SmartLab...
      </div>
    );
  }

  return (
    <>
      <RouterProvider router={appRouter} />
      <Toaster />
    </>
  );
}

export default function App() {
  return (
    <AppDataProvider>
      <AppBootstrap />
    </AppDataProvider>
  );
}
