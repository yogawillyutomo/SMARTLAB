import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  createLaboratorySessionGateway,
  LaboratorySessionContractError,
  parseLaboratorySession,
} from '@/services/laboratorySessionApi';

const ids = {
  session: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  school: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  source: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  lab: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  owner: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  teacher: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
  class: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
  subject: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
  report: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
};
const report = { id: ids.report, reportNumber: 'RPT-20260914-G5FB3', reportType: 'practicum' as const, status: 'draft' as const, version: 1 };
const session = {
  id: ids.session,
  schoolId: ids.school,
  sessionNumber: 'SES-20260914-G5FAV',
  source: {
    type: 'schedule_occurrence' as const,
    id: ids.source,
    versionEvidence: 1,
    fingerprint: 'a'.repeat(64),
    publicationId: ids.source,
    evidence: {},
    ownerMembershipId: ids.owner,
    date: '2026-09-14',
    startsAt: '07:00:00',
    endsAt: '08:45:00',
  },
  laboratory: { id: ids.lab, code: 'LAB-1', name: 'Lab 1', capacity: 36, status: 'active' as const },
  activityKind: 'practical' as const,
  responsibility: {
    teacherId: ids.teacher,
    name: 'Guru A',
    teacherCode: 'T-A',
    academicClass: { id: ids.class, code: 'XI-PPLG-1', name: 'XI PPLG 1', studentCount: 32 },
    subject: { id: ids.subject, code: 'WEB', name: 'Pemrograman Web' },
    plannedParticipantCount: 32,
  },
  status: 'ended' as const,
  openingCondition: null,
  closingCondition: 'Rapi',
  endOutcome: 'completed' as const,
  operationalNotes: null,
  actualStartedAt: '2026-09-14T00:05:00.000Z',
  actualEndedAt: '2026-09-14T01:45:00.000Z',
  cancelledAt: null,
  cancellationReason: null,
  activityReport: report,
  version: 3,
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T01:45:00.000Z',
  timeline: [{ eventType: 'laboratory_session.ended', actorName: 'Guru A', at: '2026-09-14T01:45:00.000Z', payload: {}, versionBefore: 2, versionAfter: 3 }],
};
const source = {
  sourceType: 'schedule_occurrence' as const,
  sourceId: ids.source,
  sourceNumber: 'SCH-001',
  date: '2026-09-14',
  startsAt: '07:00:00',
  endsAt: '08:45:00',
  activityKind: 'practical' as const,
  title: 'Pemrograman Web',
  subtitle: 'XI PPLG 1',
  laboratory: session.laboratory,
  responsibility: {
    name: 'Guru A',
    teacherId: ids.teacher,
    academicClass: { id: ids.class, code: 'XI-PPLG-1', name: 'XI PPLG 1' },
    subject: { id: ids.subject, code: 'WEB', name: 'Pemrograman Web' },
    plannedParticipantCount: 32,
  },
  session: { id: ids.session, sessionNumber: session.sessionNumber, status: 'ended' as const, version: 3, actualStartedAt: session.actualStartedAt, actualEndedAt: session.actualEndedAt, activityReport: report },
};
function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn() as ApiClient['get'],
    post: vi.fn() as ApiClient['post'],
    put: vi.fn() as ApiClient['put'],
    patch: vi.fn() as ApiClient['patch'],
    delete: vi.fn() as ApiClient['delete'],
    ...overrides,
  };
}

describe('laboratory session API contract', () => {
  it('parses canonical session and rejects malformed lifecycle data', () => {
    expect(parseLaboratorySession(session)).toEqual(session);
    expect(() => parseLaboratorySession({ ...session, status: 'running' })).toThrow(LaboratorySessionContractError);
    expect(() => parseLaboratorySession({ ...session, source: { ...session.source, fingerprint: 'short' } })).toThrow(LaboratorySessionContractError);
  });

  it('uses canonical discovery and mutation endpoints with If-Match', async () => {
    const get = vi.fn(async (path: string) => path.startsWith('/laboratory-session-sources')
      ? { data: [source], meta: { from: '2026-09-14', to: '2026-09-14', scope: 'mine', count: 1 } }
      : { data: [session], meta: { page: 1, perPage: 500, total: 1, lastPage: 1, from: '2026-09-01', to: '2026-09-30' } }) as ApiClient['get'];
    const post = vi.fn(async () => ({ data: session })) as ApiClient['post'];
    const gateway = createLaboratorySessionGateway(client({ get, post }));

    await gateway.sources({ from: '2026-09-14', to: '2026-09-14', scope: 'mine' });
    await gateway.listAll({ from: '2026-09-01', to: '2026-09-30', scope: 'mine' });
    await gateway.prepare({ sourceType: 'schedule_occurrence', sourceId: ids.source });
    await gateway.start(ids.session, 1);
    await gateway.end(ids.session, 2, { endOutcome: 'completed' });
    await gateway.cancel(ids.session, 3, 'Tidak jadi');

    expect(get).toHaveBeenCalledWith('/laboratory-session-sources?from=2026-09-14&to=2026-09-14&scope=mine');
    expect(post).toHaveBeenCalledWith(`/laboratory-sessions/${ids.session}/start`, undefined, { ifMatch: '"1"' });
    expect(post).toHaveBeenCalledWith(`/laboratory-sessions/${ids.session}/end`, { endOutcome: 'completed' }, { ifMatch: '"2"' });
    expect(post).toHaveBeenCalledWith(`/laboratory-sessions/${ids.session}/cancel`, { reason: 'Tidak jadi' }, { ifMatch: '"3"' });
  });
});
