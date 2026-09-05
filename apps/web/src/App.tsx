import { useEffect, useRef } from 'react';
import { createBrowserRouter, Navigate, Route, RouterProvider, Routes } from 'react-router-dom';
import { AppDataProvider } from '@/hooks/useAppData';
import { AppLayout } from '@/layouts/AppLayout';
import { RequireAuth, RequirePermission, RequireServerPermission, NotFoundPage } from '@/routes/guards';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { MonitoringPage } from '@/pages/MonitoringPage';
import { Toaster } from '@/components/ui/Toaster';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { useAppData } from '@/hooks/useAppData';

// Pages
import { LaboratoriesPage, LaboratoryDetailPage } from '@/pages/LaboratoryApiPages';
import LaboratoryLayoutApiPage from '@/pages/LaboratoryLayoutApiPage';
import { DevicesPage, DeviceDetailPage } from '@/pages/DeviceApiPages';
import { SchedulesPage } from '@/pages/SchedulesPage';
import { BookingsPage } from '@/pages/BookingsPage';
import { SessionsPage } from '@/pages/SessionsPage';
import { JournalsPage } from '@/pages/JournalsPage';
import { AssetsPage, AssetDetailPage } from '@/pages/AssetsPage';
import { StockPage } from '@/pages/StockPage';
import { IncidentsPage } from '@/pages/IncidentApiPages';
import { IncidentDetailPage } from '@/pages/IncidentDetailApiPage';
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
        <Route path="/laboratories" element={<RequireServerPermission permission="laboratories.view"><LaboratoriesPage /></RequireServerPermission>} />
        <Route path="/laboratories/:id" element={<RequireServerPermission permission="laboratories.view"><LaboratoryDetailPage /></RequireServerPermission>} />
        <Route path="/laboratories/:laboratoryId/layout" element={<RequireServerPermission permission="layouts.view"><LaboratoryLayoutApiPage /></RequireServerPermission>} />
        <Route path="/devices" element={<RequireServerPermission permission="devices.view"><DevicesPage /></RequireServerPermission>} />
        <Route path="/devices/:id" element={<RequireServerPermission permission="devices.view"><DeviceDetailPage /></RequireServerPermission>} />
        <Route path="/schedules" element={<RequireServerPermission permission="schedules.view"><SchedulesPage /></RequireServerPermission>} />
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
        <Route path="/incidents" element={<RequireServerPermission permission="incidents.view"><IncidentsPage /></RequireServerPermission>} />
        <Route path="/incidents/:incidentId" element={<RequireServerPermission permission="incidents.view"><IncidentDetailPage /></RequireServerPermission>} />
        <Route path="/work-orders" element={<RequirePermission module="work-orders"><WorkOrdersPage /></RequirePermission>} />
        <Route path="/work-orders/:id" element={<RequirePermission module="work-orders"><WorkOrdersPage /></RequirePermission>} />
        <Route path="/maintenance" element={<RequirePermission module="maintenance"><MaintenancePage /></RequirePermission>} />
        <Route path="/loans" element={<RequirePermission module="loans"><LoansPage /></RequirePermission>} />
        <Route path="/calendar" element={<RequireServerPermission permission="calendar.view"><CalendarPage /></RequireServerPermission>} />
        <Route path="/reports" element={<RequirePermission module="reports"><ReportsPage /></RequirePermission>} />
        <Route path="/notifications" element={<RequirePermission module="notifications"><NotificationsPage /></RequirePermission>} />
        <Route path="/users" element={<RequireServerPermission permission="users.view"><UsersPage /></RequireServerPermission>} />
        <Route path="/roles" element={<RequireServerPermission permission="roles.view"><RolesPage /></RequireServerPermission>} />
        <Route path="/master-data" element={<RequireServerPermission permission="master-data.view"><MasterDataPage /></RequireServerPermission>} />
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
  const { ready } = useAppData();
  const bootstrapSession = useAuthStore((state) => state.bootstrapSession);
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
    void bootstrapSession();
  }, [bootstrapSession]);

  if (!ready || !isUIHydrated) {
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
