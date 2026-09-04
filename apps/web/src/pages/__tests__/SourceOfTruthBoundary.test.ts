import { describe, expect, it } from 'vitest';
import appSource from '@/App.tsx?raw';
import dashboardSource from '@/pages/DashboardPage.tsx?raw';
import masterDataSource from '@/pages/MasterDataPage.tsx?raw';
import navSource from '@/routes/nav.ts?raw';
import sidebarSource from '@/components/layout/AppSidebar.tsx?raw';
import topbarSource from '@/components/layout/AppTopbar.tsx?raw';
import uiStoreSource from '@/stores/uiStore.ts?raw';

describe('source-of-truth migration foundation', () => {
  it('keeps Dashboard canonical for server-backed Laboratory, Device, and Incident data', () => {
    expect(dashboardSource).not.toContain('useAppData');
    expect(dashboardSource).not.toContain('services/repositories');
    expect(dashboardSource).not.toContain('db.labs');
    expect(dashboardSource).not.toContain('db.devices');
    expect(dashboardSource).not.toContain('db.incidents');
    expect(dashboardSource).toContain("from '@/services/laboratoryApi'");
    expect(dashboardSource).toContain("from '@/services/deviceApi'");
    expect(dashboardSource).toContain("from '@/services/incidentApi'");
    expect(dashboardSource).toContain('Dashboard tidak lagi mengambil nilai seed/browser');
  });

  it('does not show browser-local badge counts from the production sidebar', () => {
    expect(sidebarSource).not.toContain('useAppData');
    expect(sidebarSource).not.toContain('pendingBookings');
    expect(sidebarSource).not.toContain('overdueLoans');
    expect(sidebarSource).not.toContain('overdueMaintenance');
  });

  it('uses Laboratory API for the active-lab selector and does not search local business records', () => {
    expect(topbarSource).not.toContain('useAppData');
    expect(topbarSource).not.toContain('db.notifications');
    expect(topbarSource).not.toContain('db.devices');
    expect(topbarSource).not.toContain('db.assets');
    expect(topbarSource).not.toContain('db.incidents');
    expect(topbarSource).toContain("from '@/services/laboratoryApi'");
    expect(topbarSource).toContain('laboratoryGateway.list()');
    expect(topbarSource).toContain('Notifikasi server belum tersedia');
  });

  it('keeps Academic Master Data server-authoritative and removes local CRUD from the production page', () => {
    expect(masterDataSource).not.toContain('useAppData');
    expect(masterDataSource).not.toContain('services/repositories');
    expect(masterDataSource).not.toContain('masterDataRepository');
    expect(masterDataSource).not.toContain('deleteItem');
    expect(masterDataSource).toContain("from '@/services/academicMasterApi'");
    expect(masterDataSource).toContain('academicMasterGateway');
    expect(masterDataSource).toContain("hasServerPermission(user, 'master-data.create')");
    expect(masterDataSource).toContain("hasServerPermission(user, 'master-data.update')");
  });

  it('guards Master Data routing and navigation with the canonical server permission', () => {
    expect(appSource).toContain('RequireServerPermission permission="master-data.view"');
    expect(navSource).toContain("'master-data': 'master-data.view'");
    expect(navSource).toContain("serverPermission: 'master-data.view'");
  });

  it('does not seed an active Laboratory identifier into UI state', () => {
    expect(uiStoreSource).toContain("activeLabId: ''");
    expect(uiStoreSource).not.toContain("activeLabId: 'lab-rpl-1'");
  });
});
