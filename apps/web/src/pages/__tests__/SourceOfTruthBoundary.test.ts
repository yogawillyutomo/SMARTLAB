import { describe, expect, it } from 'vitest';
import appSource from '@/App.tsx?raw';
import dashboardSource from '@/pages/DashboardPage.tsx?raw';
import monitoringSource from '@/pages/MonitoringPage.tsx?raw';
import masterDataSource from '@/pages/MasterDataPage.tsx?raw';
import schedulesSource from '@/pages/SchedulesPage.tsx?raw';
import calendarSource from '@/pages/CalendarPage.tsx?raw';
import bookingsSource from '@/pages/BookingsPage.tsx?raw';
import priorityEventsSource from '@/pages/PriorityEventsPage.tsx?raw';
import sessionsSource from '@/pages/SessionsPage.tsx?raw';
import journalsSource from '@/pages/JournalsPage.tsx?raw';
import assetsSource from '@/pages/AssetsPage.tsx?raw';
import devicesSource from '@/pages/DeviceApiPages.tsx?raw';
import incidentsSource from '@/pages/IncidentApiPages.tsx?raw';
import stockSource from '@/pages/StockPage.tsx?raw';
import loansSource from '@/pages/LoansPage.tsx?raw';
import maintenanceSource from '@/pages/MaintenancePage.tsx?raw';
import maintenanceCampaignSource from '@/components/maintenance/MaintenanceCampaignPanel.tsx?raw';
import workOrdersSource from '@/pages/WorkOrdersPage.tsx?raw';
import usersSource from '@/pages/UsersPage.tsx?raw';
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
    expect(dashboardSource).toContain("from '@/services/workOrderApi'");
    expect(dashboardSource).toContain('workOrderGateway.listAll()');
    expect(dashboardSource).toContain('Work Order Saya');
    expect(dashboardSource).toContain('Work Order Aktif');
    expect(dashboardSource).toContain('workOrder.assigneeMembershipId === user?.membership.id');
    expect(dashboardSource).toContain('to={`/work-orders/${workOrder.id}`}');
    expect(dashboardSource).not.toContain("  'Tugas Perbaikan',");
    expect(dashboardSource).not.toContain("'Aset Tetap',");
    expect(dashboardSource).not.toContain("'Stok & Spare Part',");
    expect(dashboardSource).not.toContain("'Pemeliharaan Berkala',");
    expect(dashboardSource).not.toContain("'Peminjaman Barang',");
    expect(dashboardSource).toContain('Semua Laboratorium');
    expect(dashboardSource).toContain('Telemetri realtime tetap ditahan sampai S6');
    expect(dashboardSource).toContain('Dashboard tidak mengisi kekosongan dengan data seed/browser');
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
    expect(topbarSource).toContain('Semua Laboratorium');
    expect(topbarSource).toContain('role="listbox"');
    expect(topbarSource).toContain('aria-haspopup="listbox"');
    expect(topbarSource).not.toContain('<select');
    expect(topbarSource).toContain("activeLabId !== ''");
    expect(topbarSource).toContain('Notifikasi server belum tersedia');
  });

  it('cuts Monitoring Perangkat over to canonical Device inventory while keeping S6 telemetry deferred', () => {
    expect(monitoringSource).not.toContain('useAppData');
    expect(monitoringSource).not.toContain('services/repositories');
    expect(monitoringSource).not.toContain('deviceRepository');
    expect(monitoringSource).not.toContain('simulateHeartbeat');
    expect(monitoringSource).not.toContain('mutate((d)');
    expect(monitoringSource).not.toContain('applyDeviceOperationalStatus');
    expect(monitoringSource).not.toContain('createIncidentFromDevice');
    expect(monitoringSource).not.toContain('scheduleMaintenance');
    expect(monitoringSource).toContain("from '@/services/deviceApi'");
    expect(monitoringSource).toContain('deviceGateway.list');
    expect(monitoringSource).toContain('activeLabId');
    expect(monitoringSource).toContain('Monitoring realtime belum aktif');
    expect(monitoringSource).toContain('CanonicalPcCard');
    expect(monitoringSource).toContain('DEVICE_LIFECYCLE_LABELS[device.lifecycleStatus]');
    expect(monitoringSource).toContain('grid-cols-3');
    expect(monitoringSource).toContain('tidak ada simulasi atau mutation browser-local');
    expect(monitoringSource).toContain('S6 akan menambahkan telemetry tanpa mengubah Device/Asset authority');
    expect(appSource).toContain('path="/monitoring" element={<RequireServerPermission permission="devices.view"');
    expect(navSource).toContain("to: '/monitoring', label: 'Monitoring Perangkat'");
    expect(navSource).toContain("serverPermission: 'devices.view'");
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


  it('keeps the schedule route server-authoritative and removes browser-local schedule CRUD', () => {
    expect(schedulesSource).not.toContain('useAppData');
    expect(schedulesSource).not.toContain('db.schedules');
    expect(schedulesSource).not.toContain('services/repositories');
    expect(schedulesSource).not.toContain('Tambah Jadwal Reguler');
    expect(schedulesSource).not.toContain('Edit Jadwal Reguler');
    expect(schedulesSource).not.toContain('ConfirmDialog');
    expect(schedulesSource).toContain("from '@/services/scheduleOccurrenceApi'");
    expect(schedulesSource).toContain('scheduleOccurrenceGateway.listAll');
    expect(schedulesSource).toContain("from '@/stores/uiStore'");
    expect(schedulesSource).toContain('laboratoryId: activeLabId');
    expect(schedulesSource).not.toContain('label="Laboratorium Operasional"');
    expect(schedulesSource).toContain("from '@/services/scheduleExceptionApi'");
    expect(schedulesSource).toContain('scheduleExceptionGateway.create');
    expect(schedulesSource).toContain("hasServerPermission(user, 'schedule-exceptions.create')");
    expect(schedulesSource).toContain('TESSELA tetap source plan');
    expect(schedulesSource).toContain('Exception tidak mengubah recurring timetable sumber');
    expect(appSource).toContain('RequireServerPermission permission="schedules.view"');
    expect(navSource).toContain("schedules: 'schedules.view'");
    expect(navSource).toContain("serverPermission: 'schedules.view'");
  });

  it('keeps the calendar route server-authoritative and removes browser-local calendar mutations', () => {
    expect(calendarSource).not.toContain('useAppData');
    expect(calendarSource).not.toContain('db.calendarEvents');
    expect(calendarSource).not.toContain('mutate((d)');
    expect(calendarSource).toContain("from '@/services/calendarApi'");
    expect(calendarSource).toContain('calendarEventGateway.list');
    expect(calendarSource).toContain("from '@/stores/uiStore'");
    expect(calendarSource).toContain("event.scope==='school'||event.laboratory?.id===activeLabId");
    expect(calendarSource).toContain("scope:'laboratory',laboratoryId:activeLabId");
    expect(appSource).toContain('RequireServerPermission permission="calendar.view"');
    expect(navSource).toContain("calendar: 'calendar.view'");
    expect(navSource).toContain("serverPermission: 'calendar.view'");
  });

  it('keeps the bookings route server-authoritative and removes browser-local booking conflicts', () => {
    expect(bookingsSource).not.toContain('useAppData');
    expect(bookingsSource).not.toContain('db.bookings');
    expect(bookingsSource).not.toContain('mutate((d)');
    expect(bookingsSource).not.toContain('checkConflict');
    expect(bookingsSource).toContain("from '@/services/laboratoryReservationApi'");
    expect(bookingsSource).toContain('laboratoryReservationGateway');
    expect(bookingsSource).toContain("from '@/stores/uiStore'");
    expect(bookingsSource).toContain('laboratoryId: activeLabId');
    expect(bookingsSource).toContain('contextLabs');
    expect(bookingsSource).toContain('laboratoryAvailabilityGateway.check');
    expect(appSource).toContain('RequireServerPermission permission="bookings.view"');
    expect(navSource).toContain("bookings: 'bookings.view'");
    expect(navSource).toContain("serverPermission: 'bookings.view'");
  });

  it('keeps Priority Events server-authoritative and explicit-reconciliation only', () => {
    expect(priorityEventsSource).not.toContain('useAppData');
    expect(priorityEventsSource).not.toContain('db.specialEvents');
    expect(priorityEventsSource).not.toContain('services/repositories');
    expect(priorityEventsSource).toContain("from '@/services/priorityEventApi'");
    expect(priorityEventsSource).toContain('priorityEventGateway');
    expect(priorityEventsSource).toContain("hasServerPermission(user, 'priority-events.approve')");
    expect(priorityEventsSource).toContain('Priority tidak berarti force override');
    expect(appSource).toContain('RequireServerPermission permission="priority-events.view"');
    expect(navSource).toContain("serverPermission: 'priority-events.view'");
  });

  it('cuts Pelaksanaan Lab and Journals over to canonical Session/ActivityReport APIs', () => {
    expect(sessionsSource).not.toContain('useAppData');
    expect(sessionsSource).not.toContain('db.sessions');
    expect(sessionsSource).not.toContain('db.journals');
    expect(sessionsSource).not.toContain('mutate((d)');
    expect(sessionsSource).toContain("from '@/services/laboratorySessionApi'");
    expect(sessionsSource).toContain("from '@/services/activityReportApi'");
    expect(sessionsSource).toContain('laboratorySessionGateway.sources');
    expect(sessionsSource).toContain("from '@/stores/uiStore'");
    expect(sessionsSource).toContain('laboratoryId: activeLabId');
    expect(sessionsSource).toContain('activityReportGateway.listAll');
    expect(sessionsSource).toContain('activityReportGateway');
    expect(sessionsSource).toContain('Tidak ada lagi Session/Journal browser-local');
    expect(journalsSource).toContain("'/sessions?tab=history'");
    expect(journalsSource).not.toContain('useAppData');
    expect(appSource).toContain('RequireServerPermission permission="sessions.view"');
    expect(appSource).toContain('RequireServerPermission permission="activity-reports.view"');
    expect(navSource).toContain("serverPermission: 'sessions.view'");
  });

  it('keeps S3.5 observations explicit and report attachments server-backed', () => {
    expect(sessionsSource).toContain("from '@/services/sessionObservationApi'");
    expect(sessionsSource).toContain('sessionObservationGateway.create');
    expect(sessionsSource).toContain('sessionObservationGateway.promote');
    expect(sessionsSource).toContain('Temuan adalah evidence pelaksanaan. Menyimpan form ini tidak membuat Incident.');
    expect(sessionsSource).toContain('Promosikan Temuan menjadi Incident');
    expect(sessionsSource).toContain('activityReportGateway.uploadAttachment');
    expect(sessionsSource).toContain('activityReportAttachmentDownloadUrl');
    expect(sessionsSource).toContain('Private storage');
    expect(sessionsSource).not.toContain('db.incidents.push');
    expect(sessionsSource).not.toContain('createIncidentFromBrokenPc');
  });

  it('keeps S3.6 offline support limited to ActivityReport draft working copies', () => {
    expect(sessionsSource).toContain("from '@/services/activityReportOfflineDraft'");
    expect(sessionsSource).toContain('activityReportGateway.syncDraft');
    expect(sessionsSource).toContain('Mode offline terbatas');
    expect(sessionsSource).toContain('Rebase Draft Lokal');
    expect(sessionsSource).toContain('Gunakan Versi Server');
    expect(sessionsSource).toContain('Session lifecycle, Temuan/Incident, submit/verifikasi, backfill, dan attachment tetap online-only');
    expect(sessionsSource).not.toContain('offlineSessionQueue');
    expect(sessionsSource).not.toContain('offlineIncidentQueue');
    expect(sessionsSource).not.toContain('offlineAttachmentQueue');
    expect(sessionsSource).not.toContain('queueAttachment');
  });

  it('propagates the global Laboratory context through Device, Asset, and Incident pages', () => {
    expect(devicesSource).toContain("from '@/stores/uiStore'");
    expect(devicesSource).toContain('homeLaboratoryId: activeLabId');
    expect(devicesSource).toContain('setActiveLab(next.homeLaboratoryId)');
    expect(assetsSource).toContain("from '@/stores/uiStore'");
    expect(assetsSource).toContain('assetGateway.listAll(activeLabId ? { homeLaboratoryId: activeLabId } : {})');
    expect(incidentsSource).toContain("from '@/stores/uiStore'");
    expect(incidentsSource).toContain('activeLabId || undefined');
    expect(incidentsSource).toContain('scopedLaboratories');
    expect(workOrdersSource).toContain("from '@/stores/uiStore'");
    expect(workOrdersSource).toContain('workOrder.laboratoryId === activeLabId');
    expect(workOrdersSource).toContain('data={scopedWorkOrders}');
    expect(workOrdersSource).toContain('scopedAssets.filter');
    expect(maintenanceSource).toContain("from '@/stores/uiStore'");
    expect(maintenanceSource).toContain('scopedAssetIds.has(plan.assetId)');
    expect(maintenanceSource).toContain('scopedAssetIds.has(execution.assetId)');
    expect(maintenanceCampaignSource).toContain('maintenanceGateway.listAllCampaigns(activeLabId || undefined)');
  });

  it('cuts fixed Assets over to canonical S4.2 API authority', () => {
    expect(assetsSource).not.toContain('useAppData');
    expect(assetsSource).not.toContain('db.assets');
    expect(assetsSource).not.toContain('mutate((d)');
    expect(assetsSource).not.toContain('Stock Opname');
    expect(assetsSource).not.toContain('QR Code Aset');
    expect(assetsSource).not.toContain('Mutasi Aset');
    expect(assetsSource).not.toContain('Hapus aset');
    expect(assetsSource).toContain("from '@/services/assetApi'");
    expect(assetsSource).toContain('assetGateway.listAll(activeLabId ? { homeLaboratoryId: activeLabId } : {})');
    expect(assetsSource).toContain('assetGateway.linkDevice');
    expect(assetsSource).toContain('Tidak ada lagi mutation Asset browser-local');
    expect(appSource).toContain('RequireServerPermission permission="assets.view"');
    expect(navSource).toContain("assets: 'assets.view'");
    expect(navSource).toContain("serverPermission: 'assets.view'");
  });

  it('cuts stock and spare parts over to the canonical S4.3 immutable ledger', () => {
    expect(stockSource).not.toContain('useAppData');
    expect(stockSource).not.toContain('db.stock');
    expect(stockSource).not.toContain('mutate((d)');
    expect(stockSource).not.toContain('ConfirmDialog');
    expect(stockSource).not.toContain('Trash2');
    expect(stockSource).toContain("from '@/services/inventoryApi'");
    expect(stockSource).toContain('inventoryGateway.listAllItems()');
    expect(stockSource).toContain('inventoryGateway.listAllTransactions()');
    expect(stockSource).toContain('inventoryGateway.transact');
    expect(stockSource).toContain('Tidak ada direct quantity edit browser-local');
    expect(stockSource).toContain('Saldo awal harus dicatat sebagai transaksi');
    expect(appSource).toContain('RequireServerPermission permission="stock.view"');
    expect(navSource).toContain("stock: 'stock.view'");
    expect(navSource).toContain("serverPermission: 'stock.view'");
  });

  it('cuts Loan custody over to canonical S4.4 exact-Asset server authority', () => {
    expect(loansSource).not.toContain('useAppData');
    expect(loansSource).not.toContain('db.loans');
    expect(loansSource).not.toContain('mutate((d)');
    expect(loansSource).not.toContain('usePermission');
    expect(loansSource).not.toContain('markOverdue');
    expect(loansSource).not.toContain('createIncident');
    expect(loansSource).not.toContain('itemName');
    expect(loansSource).not.toContain('form.quantity');
    expect(loansSource).not.toContain('l.quantity');
    expect(loansSource).not.toContain('quantity: Number');
    expect(loansSource).toContain("from '@/services/loanApi'");
    expect(loansSource).toContain("from '@/services/assetApi'");
    expect(loansSource).toContain('loanGateway.listAll()');
    expect(loansSource).toContain('loanGateway.checkout');
    expect(loansSource).toContain('loanGateway.returnLoan');
    expect(loansSource).toContain('satu LoanItem → satu Asset ULID exact');
    expect(loansSource).toContain('Return melepaskan custody Loan dan menyimpan evidence.');
    expect(loansSource).toContain('Asset condition, atau Incident secara implisit.');
    expect(loansSource).toContain('Incident dan perubahan kondisi Asset harus dilakukan eksplisit melalui authority masing-masing.');
    expect(appSource).toContain('RequireServerPermission permission="loans.view"');
    expect(navSource).toContain("loans: 'loans.view'");
    expect(navSource).toContain("serverPermission: 'loans.view'");
  });

  it('cuts Preventive Maintenance over to canonical S4.5 exact-Asset server authority', () => {
    expect(maintenanceSource).not.toContain('useAppData');
    expect(maintenanceSource).not.toContain('db.maintenance');
    expect(maintenanceSource).not.toContain('mutate((d)');
    expect(maintenanceSource).not.toContain('usePermission');
    expect(maintenanceSource).not.toContain('ConfirmDialog');
    expect(maintenanceSource).not.toContain('assetCode: execForm');
    expect(maintenanceSource).toContain("from '@/services/maintenanceApi'");
    expect(maintenanceSource).toContain("from '@/services/assetApi'");
    expect(maintenanceSource).toContain("from '@/services/inventoryApi'");
    expect(maintenanceSource).toContain('maintenanceGateway.listAllPlans()');
    expect(maintenanceSource).toContain('maintenanceGateway.startExecution');
    expect(maintenanceSource).toContain('maintenanceGateway.completeExecution');
    expect(maintenanceSource).toContain('checklistReadyForCompletion');
    expect(maintenanceSource).toContain('Seluruh checklist harus selesai sebelum Maintenance dapat diselesaikan.');
    expect(maintenanceSource).toContain('variant="danger"');
    expect(maintenanceSource).toContain('satu Asset canonical');
    expect(maintenanceSource).toContain('Corrective repair tetap S5 Work Order');
    expect(appSource).toContain('RequireServerPermission permission="maintenance.view"');
    expect(navSource).toContain("maintenance: 'maintenance.view'");
    expect(navSource).toContain("serverPermission: 'maintenance.view'");
  });


  it('keeps Maintenance Campaign as Lab-level orchestration over exact-Asset Maintenance authority', () => {
    expect(maintenanceCampaignSource).not.toContain('useAppData');
    expect(maintenanceCampaignSource).not.toContain('mutate((d)');
    expect(maintenanceCampaignSource).not.toContain('db.maintenance');
    expect(maintenanceCampaignSource).not.toContain('db.assets');
    expect(maintenanceCampaignSource).not.toContain('custody_active');
    expect(maintenanceCampaignSource).toContain("from '@/services/maintenanceApi'");
    expect(maintenanceCampaignSource).toContain("from '@/services/laboratoryApi'");
    expect(maintenanceCampaignSource).toContain("from '@/services/assetApi'");
    expect(maintenanceCampaignSource).toContain('maintenanceGateway.createCampaign');
    expect(maintenanceCampaignSource).toContain('maintenanceGateway.scheduleCampaign');
    expect(maintenanceCampaignSource).toContain("asset.homeLaboratoryId === form.laboratoryId");
    expect(maintenanceCampaignSource).toContain('Campaign bukan custody dan tidak menutup Laboratorium');
    expect(maintenanceCampaignSource).toContain('MaintenanceExecution exact-Asset');
    expect(maintenanceCampaignSource).toContain("campaign.status === 'active' ? 'warning' : 'success'");
    expect(maintenanceSource).toContain('MaintenanceCampaignPanel');
    expect(maintenanceSource).toContain('Campaign & Batch');
  });

  it('requires explicit role selection when creating a School membership', () => {
    expect(usersSource).toContain('setForm(emptyForm())');
    expect(usersSource).not.toContain("roleKeys: roles.some((role) => role.key === 'siswa') ? ['siswa'] : []");
    expect(usersSource).toContain("if (form.roleKeys.length === 0) errors.roleKeys = 'Minimal satu role wajib dipilih.';");
  });

  it('cuts Corrective Work Orders over to canonical S5 exact-Asset server authority', () => {
    expect(workOrdersSource).not.toContain('useAppData');
    expect(workOrdersSource).not.toContain('db.workOrders');
    expect(workOrdersSource).not.toContain('mutate((d)');
    expect(workOrdersSource).not.toContain('applyDeviceOperationalStatus');
    expect(workOrdersSource).not.toContain('stock.create');
    expect(workOrdersSource).not.toContain('d.stock');
    expect(workOrdersSource).not.toContain('formatCurrency');
    expect(workOrdersSource).toContain("from '@/services/workOrderApi'");
    expect(workOrdersSource).toContain("from '@/services/assetApi'");
    expect(workOrdersSource).toContain("from '@/services/inventoryApi'");
    expect(workOrdersSource).toContain('workOrderGateway.listAll()');
    expect(workOrdersSource).toContain('workOrderGateway.usePart');
    expect(workOrdersSource).toContain('workOrderGateway.verify');
    expect(workOrdersSource).toContain('event.payload.assignee');
    expect(workOrdersSource).toContain("event.eventType === 'work_order.assigned' ? 'Teknisi ditugaskan' : 'Teknisi diganti'");
    expect(workOrdersSource).toContain('Tidak ada lagi Work Order browser-local');
    expect(workOrdersSource).toContain('tidak mengubah Device atau Incident secara implisit');
    expect(appSource).toContain('RequireServerPermission permission="work-orders.view"');
    expect(navSource).toContain("'work-orders': 'work-orders.view'");
    expect(navSource).toContain("serverPermission: 'work-orders.view'");
  });

  it('closes the S4 production source-of-truth boundary across all four canonical routes', () => {
    const s4Sources = [assetsSource, stockSource, loansSource, maintenanceSource];

    for (const source of s4Sources) {
      expect(source).not.toContain('useAppData');
      expect(source).not.toContain('mutate((d)');
      expect(source).not.toContain('services/repositories');
      expect(source).not.toContain('usePermission');
      expect(source).not.toContain('db.workOrders');
      expect(source).not.toContain('workOrderRepository');
    }

    expect(assetsSource).not.toContain('db.assets');
    expect(stockSource).not.toContain('db.stock');
    expect(loansSource).not.toContain('db.loans');
    expect(maintenanceSource).not.toContain('db.maintenance');

    expect(assetsSource).toContain('assetGateway');
    expect(stockSource).toContain('inventoryGateway');
    expect(loansSource).toContain('loanGateway');
    expect(maintenanceSource).toContain('maintenanceGateway');

    expect(appSource).toContain('RequireServerPermission permission="assets.view"');
    expect(appSource).toContain('RequireServerPermission permission="stock.view"');
    expect(appSource).toContain('RequireServerPermission permission="loans.view"');
    expect(appSource).toContain('RequireServerPermission permission="maintenance.view"');

    expect(navSource).toContain("assets: 'assets.view'");
    expect(navSource).toContain("stock: 'stock.view'");
    expect(navSource).toContain("loans: 'loans.view'");
    expect(navSource).toContain("maintenance: 'maintenance.view'");
  });

  it('does not seed an active Laboratory identifier into UI state', () => {
    expect(uiStoreSource).toContain("activeLabId: ''");
    expect(uiStoreSource).not.toContain("activeLabId: 'lab-rpl-1'");
  });
});
