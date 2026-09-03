import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  IncidentDetailView,
  incidentActionAvailability,
  resolvedReopenTarget,
  type IncidentDetailState,
} from '@/pages/IncidentDetailApiPage';
import type { IncidentDto } from '@/services/incidentApi';
import type { AuthenticatedUser } from '@/types';

const baseIncident: IncidentDto = {
  id: '01incident000000000000000001',
  ticketNumber: 'INC-2026-000001',
  reporter: { userId: '01reporter', name: 'Pelapor UAT' },
  laboratory: { id: '01lab', code: 'LAB-RPL-1', name: 'Lab RPL 1' },
  device: { id: '01device', deviceCode: 'PC-0001', deviceType: 'desktop_pc' },
  category: 'hardware',
  priority: 'high',
  title: 'Komputer gagal melakukan boot',
  description: 'Komputer berhenti sebelum sistem operasi selesai dimuat.',
  impact: 'Satu workstation tidak dapat digunakan.',
  blocksLaboratoryOperation: false,
  stepsTaken: 'Kabel daya telah diperiksa.',
  status: 'assigned',
  assignee: { membershipId: '01member-technician', userId: '01technician', name: 'Teknisi UAT' },
  triageSummary: 'Perlu pemeriksaan teknisi.',
  resolutionSummary: null,
  rejectionReason: null,
  verificationNote: null,
  version: 4,
  occurredAt: '2026-09-03T00:00:00.000Z',
  reportedAt: '2026-09-03T00:01:00.000Z',
  triagedAt: '2026-09-03T00:02:00.000Z',
  assignedAt: '2026-09-03T00:03:00.000Z',
  startedAt: null,
  resolvedAt: null,
  verifiedAt: null,
  closedAt: null,
  rejectedAt: null,
  createdAt: '2026-09-03T00:01:00.000Z',
  updatedAt: '2026-09-03T00:03:00.000Z',
};

function user(permissions: string[], membershipId = '01member-admin'): AuthenticatedUser {
  return {
    id: '01admin',
    name: 'Admin',
    email: 'admin@example.test',
    school: { id: '01school', code: 'SMK-01', name: 'SMK SmartLab' },
    membership: { id: membershipId, status: 'active', roles: ['Admin Lab'] },
    permissions,
    role: 'Admin Lab',
  };
}

function renderReady(incident: IncidentDto, permissions: string[] = ['incidents.view']): string {
  const state: IncidentDetailState = { status: 'ready', incident };
  return renderToStaticMarkup(
    <IncidentDetailView
      state={state}
      user={user(permissions)}
      comments={{ data: [], meta: { page: 1, perPage: 25, total: 0, lastPage: 1 } }}
      commentsLoading={false}
      events={permissions.includes('incidents.view-history') ? { data: [{
        id: '01event', incidentId: incident.id, ticketNumber: incident.ticketNumber,
        actor: { userId: '01admin', membershipId: '01member-admin', name: 'Admin' },
        eventType: 'incident.assigned', incidentVersionBefore: 3, incidentVersionAfter: 4,
        payload: { assignee: { membershipId: '01member-technician' } }, createdAt: '2026-09-03T00:03:00.000Z',
      }], meta: { page: 1, perPage: 25, total: 1, lastPage: 1 } } : null}
      eventsLoading={false}
      mutationBusy={false}
      commentText=""
      onCommentTextChange={vi.fn()}
      onRetry={vi.fn()}
      onBack={vi.fn()}
      onOpenAction={vi.fn()}
      onAddComment={vi.fn()}
      onCommentsPage={vi.fn()}
      onEventsPage={vi.fn()}
    />,
  );
}

describe('Incident workflow action matrix', () => {
  it('does not fall back to roles when exact server permissions are absent', () => {
    const actions = incidentActionAvailability(baseIncident, user([]));
    expect(actions.assign).toBe(false);
    expect(actions.start).toBe(false);
    expect(actions.resolve).toBe(false);
    expect(actions.comment).toBe(false);
    expect(actions.viewHistory).toBe(false);
  });

  it('allows assignee-owned progress with incidents.update without requiring incidents.assign', () => {
    const actions = incidentActionAvailability(baseIncident, user(['incidents.update'], '01member-technician'));
    expect(actions.start).toBe(true);
    expect(actions.resolve).toBe(true);
    expect(actions.assign).toBe(false);
  });

  it('blocks another updater from progress unless incidents.assign provides the administrative override', () => {
    expect(incidentActionAvailability(baseIncident, user(['incidents.update'])).start).toBe(false);
    expect(incidentActionAvailability(baseIncident, user(['incidents.update', 'incidents.assign'])).start).toBe(true);
  });

  it('maps approve and assignment edges to their exact capabilities', () => {
    const reported = { ...baseIncident, status: 'reported' as const, assignee: null, version: 1 };
    const triaged = { ...baseIncident, status: 'triaged' as const, assignee: null, version: 2 };
    expect(incidentActionAvailability(reported, user(['incidents.approve'])).triage).toBe(true);
    expect(incidentActionAvailability(reported, user(['incidents.approve'])).reject).toBe(true);
    expect(incidentActionAvailability(reported, user(['incidents.update', 'incidents.assign'])).correct).toBe(true);
    expect(incidentActionAvailability(triaged, user(['incidents.assign'])).assign).toBe(true);
    expect(incidentActionAvailability(triaged, user(['incidents.approve'])).resolve).toBe(true);
  });

  it('uses assignee snapshots to select the resolved reopen path', () => {
    const withAssignee = { ...baseIncident, status: 'resolved' as const, resolutionSummary: 'Selesai.', resolvedAt: '2026-09-03T01:00:00.000Z' };
    const withoutAssignee = { ...withAssignee, assignee: null };
    expect(resolvedReopenTarget(withAssignee)).toBe('in_progress');
    expect(resolvedReopenTarget(withoutAssignee)).toBe('triaged');
    expect(incidentActionAvailability(withAssignee, user(['incidents.assign'])).assign).toBe(true);
    expect(incidentActionAvailability(withoutAssignee, user(['incidents.assign'])).assign).toBe(false);
  });
});

describe('Incident workflow detail presentation', () => {
  it('renders canonical Incident evidence and no rejected legacy concepts', () => {
    const markup = renderReady(baseIncident, ['incidents.view', 'incidents.comment']);
    expect(markup).toContain('INC-2026-000001');
    expect(markup).toContain('LAB-RPL-1');
    expect(markup).toContain('PC-0001');
    expect(markup).toContain('Teknisi UAT');
    expect(markup).toContain('Komentar');
    expect(markup).toContain('Tambahkan komentar');
    expect(markup).not.toContain('Menunggu Spare Part');
    expect(markup).not.toContain('Hapus Tiket');
    expect(markup).not.toContain('Buat Work Order');
    expect(markup).not.toContain('Biaya Perbaikan');
  });

  it('keeps full internal history hidden unless incidents.view-history is exact', () => {
    expect(renderReady(baseIncident, ['incidents.view'])).not.toContain('Riwayat Internal');
    const visible = renderReady(baseIncident, ['incidents.view', 'incidents.view-history']);
    expect(visible).toContain('Riwayat Internal');
    expect(visible).toContain('incident.assigned');
    expect(visible).toContain('01member-technician');
  });

  it('keeps terminal comments readable but removes the add-comment composer', () => {
    const closed = { ...baseIncident, status: 'closed' as const, closedAt: '2026-09-03T02:00:00.000Z' };
    const markup = renderReady(closed, ['incidents.view', 'incidents.comment']);
    expect(markup).toContain('Tiket terminal tetap dapat dibaca');
    expect(markup).not.toContain('Tambahkan komentar');
  });

  it('renders controlled loading, not-found, and retryable error states', () => {
    const common = {
      user: user(['incidents.view']), comments: null, commentsLoading: false, events: null, eventsLoading: false,
      mutationBusy: false, commentText: '', onCommentTextChange: vi.fn(), onRetry: vi.fn(), onBack: vi.fn(),
      onOpenAction: vi.fn(), onAddComment: vi.fn(), onCommentsPage: vi.fn(), onEventsPage: vi.fn(),
    };
    expect(renderToStaticMarkup(<IncidentDetailView state={{ status: 'loading' }} {...common} />)).toContain('Memuat detail tiket dari server...');
    expect(renderToStaticMarkup(<IncidentDetailView state={{ status: 'not_found' }} {...common} />)).toContain('Tiket tidak ditemukan');
    expect(renderToStaticMarkup(<IncidentDetailView state={{ status: 'error', message: 'Server sibuk.', retryable: true }} {...common} />)).toContain('Coba lagi');
  });
});
