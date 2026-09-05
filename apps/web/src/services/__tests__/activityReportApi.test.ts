import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  ActivityReportContractError,
  createActivityReportGateway,
  parseActivityReport,
} from '@/services/activityReportApi';

const ids = {
  report: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  school: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  session: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  owner: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  lab: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  teacher: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
  class: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
  subject: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
  attachment: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
};
const report = {
  id: ids.report,
  schoolId: ids.school,
  reportNumber: 'RPT-20260914-G5FAV',
  origin: 'session' as const,
  sessionId: ids.session,
  ownerMembershipId: ids.owner,
  manualBackfillReason: null,
  reportType: 'practicum' as const,
  status: 'draft' as const,
  laboratory: { id: ids.lab, code: 'LAB-1', name: 'Lab 1', capacity: 36, status: 'active' as const },
  occurredOn: '2026-09-14',
  sourceSnapshot: {},
  sessionSnapshot: {},
  responsibility: {
    teacherId: ids.teacher,
    name: 'Guru A',
    teacherCode: 'T-A',
    academicClass: { id: ids.class, code: 'XI-PPLG-1', name: 'XI PPLG 1' },
    subject: { id: ids.subject, code: 'WEB', name: 'Pemrograman Web' },
  },
  attendance: { plannedParticipantCount: 32, presentCount: null, absentCount: null, notes: null, externalSystem: null, externalReferenceId: null },
  commonContent: { objective: null, material: null, resources: null, issues: null, followUp: null, outcomeReflection: null },
  typeSpecificContent: {},
  revisionReason: null,
  submittedAt: null,
  verifiedAt: null,
  version: 1,
  createdAt: '2026-09-14T01:45:00.000Z',
  updatedAt: '2026-09-14T01:45:00.000Z',
  timeline: [{ eventType: 'activity_report.created', actorName: 'Guru A', at: '2026-09-14T01:45:00.000Z', payload: {}, versionBefore: 0, versionAfter: 1 }],
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

describe('activity report API contract', () => {
  it('parses canonical report and rejects malformed report state', () => {
    expect(parseActivityReport(report)).toEqual(report);
    expect(() => parseActivityReport({ ...report, status: 'done' })).toThrow(ActivityReportContractError);
    expect(() => parseActivityReport({ ...report, attendance: { ...report.attendance, presentCount: -1 } })).toThrow(ActivityReportContractError);
  });

  it('uses canonical report endpoints and version preconditions', async () => {
    const get = vi.fn(async () => ({ data: [report], meta: { page: 1, perPage: 500, total: 1, lastPage: 1, from: '2026-09-01', to: '2026-09-30' } })) as ApiClient['get'];
    const post = vi.fn(async (path: string, body?: unknown) => path.endsWith('/sync-draft')
      ? {
          data: { ...report, version: 2 },
          sync: {
            clientMutationId: '550e8400-e29b-41d4-a716-446655440000',
            baseVersion: 1,
            appliedVersion: 2,
            replayed: false,
          },
        }
      : { data: report }) as ApiClient['post'];
    const patch = vi.fn(async () => ({ data: report })) as ApiClient['patch'];
    const postForm = vi.fn(async () => ({
      data: {
        id: ids.attachment,
        reportId: ids.report,
        storageProvider: 'local',
        fileName: 'bukti.png',
        mediaType: 'image/png',
        sizeBytes: 1234,
        sha256: 'a'.repeat(64),
        available: true,
        uploadedBy: { userId: ids.teacher, membershipId: ids.owner, name: 'Guru A' },
        createdAt: '2026-09-14T01:46:00.000Z',
      },
      reportVersion: 2,
    })) as NonNullable<ApiClient['postForm']>;
    const gateway = createActivityReportGateway(client({ get, post, patch, postForm }));

    await gateway.listAll({ from: '2026-09-01', to: '2026-09-30', scope: 'mine' });
    await gateway.update(ids.report, 1, { presentCount: 31, absentCount: 1 });
    const sync = await gateway.syncDraft(ids.report, {
      clientMutationId: '550e8400-e29b-41d4-a716-446655440000',
      baseVersion: 1,
      patch: { attendanceNotes: 'Offline' },
    });
    expect(sync.sync.appliedVersion).toBe(2);
    await gateway.submit(ids.report, 2);
    await gateway.requestRevision(ids.report, 3, 'Lengkapi refleksi');
    await gateway.reopen(ids.report, 4);
    await gateway.verify(ids.report, 5);
    await gateway.backfill({
      reportType: 'general',
      laboratoryId: ids.lab,
      occurredOn: '2026-09-01',
      manualBackfillReason: 'Migrasi arsip',
      responsibleName: 'Guru Arsip',
      activityDescription: 'Kegiatan historis',
    });
    const uploadFile = new File(['evidence'], 'bukti.png', { type: 'image/png' });
    const upload = await gateway.uploadAttachment(ids.report, 1, uploadFile);
    expect(upload.reportVersion).toBe(2);

    expect(patch).toHaveBeenCalledWith(`/activity-reports/${ids.report}`, { presentCount: 31, absentCount: 1 }, { ifMatch: '"1"' });
    expect(post).toHaveBeenCalledWith(
      `/activity-reports/${ids.report}/sync-draft`,
      {
        clientMutationId: '550e8400-e29b-41d4-a716-446655440000',
        baseVersion: 1,
        patch: { attendanceNotes: 'Offline' },
      },
    );
    expect(post).toHaveBeenCalledWith(`/activity-reports/${ids.report}/submit`, undefined, { ifMatch: '"2"' });
    expect(post).toHaveBeenCalledWith(`/activity-reports/${ids.report}/request-revision`, { reason: 'Lengkapi refleksi' }, { ifMatch: '"3"' });
    expect(post).toHaveBeenCalledWith(`/activity-reports/${ids.report}/reopen`, undefined, { ifMatch: '"4"' });
    expect(post).toHaveBeenCalledWith(`/activity-reports/${ids.report}/verify`, undefined, { ifMatch: '"5"' });
    expect(postForm).toHaveBeenCalledWith(
      `/activity-reports/${ids.report}/attachments`,
      expect.any(FormData),
      { ifMatch: '"1"' },
    );
  });
});
