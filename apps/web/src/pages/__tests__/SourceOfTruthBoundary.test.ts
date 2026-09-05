import { describe, expect, it } from 'vitest';
import appSource from '@/App.tsx?raw';
import dashboardSource from '@/pages/DashboardPage.tsx?raw';
import masterDataSource from '@/pages/MasterDataPage.tsx?raw';
import schedulesSource from '@/pages/SchedulesPage.tsx?raw';
import calendarSource from '@/pages/CalendarPage.tsx?raw';
import bookingsSource from '@/pages/BookingsPage.tsx?raw';
import priorityEventsSource from '@/pages/PriorityEventsPage.tsx?raw';
import sessionsSource from '@/pages/SessionsPage.tsx?raw';
import journalsSource from '@/pages/JournalsPage.tsx?raw';
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


  it('keeps the schedule route server-authoritative and removes browser-local schedule CRUD', () => {
    expect(schedulesSource).not.toContain('useAppData');
    expect(schedulesSource).not.toContain('db.schedules');
    expect(schedulesSource).not.toContain('services/repositories');
    expect(schedulesSource).not.toContain('Tambah Jadwal Reguler');
    expect(schedulesSource).not.toContain('Edit Jadwal Reguler');
    expect(schedulesSource).not.toContain('ConfirmDialog');
    expect(schedulesSource).toContain("from '@/services/scheduleOccurrenceApi'");
    expect(schedulesSource).toContain('scheduleOccurrenceGateway.listAll');
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

  it('does not seed an active Laboratory identifier into UI state', () => {
    expect(uiStoreSource).toContain("activeLabId: ''");
    expect(uiStoreSource).not.toContain("activeLabId: 'lab-rpl-1'");
  });
});
