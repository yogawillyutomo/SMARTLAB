import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  createIncidentGateway,
  IncidentContractError,
  parseIncidentCommentCollectionResponse,
  parseIncidentEventCollectionResponse,
  parseIncidentListResponse,
  parseIncidentResponse,
} from '@/services/incidentApi';

const incidentId = '01m0r8nsw938c2zcv44zyge800';
const laboratoryId = '01m0r8nsw938c2zcv44zyge801';
const deviceId = '01m0r8nsw938c2zcv44zyge802';
const reporterUserId = '01m0r8nsw938c2zcv44zyge803';
const assigneeMembershipId = '01m0r8nsw938c2zcv44zyge804';
const assigneeUserId = '01m0r8nsw938c2zcv44zyge805';
const actorMembershipId = '01m0r8nsw938c2zcv44zyge806';

function incident(overrides: Record<string, unknown> = {}) {
  return {
    id: incidentId,
    ticketNumber: 'INC-2026-000001',
    reporter: { userId: reporterUserId, name: 'Pelapor UAT' },
    laboratory: { id: laboratoryId, code: 'LAB-01', name: 'Lab PPLG 1' },
    device: { id: deviceId, deviceCode: 'PC-0001', deviceType: 'desktop_pc' },
    category: 'hardware',
    priority: 'high',
    title: 'Komputer tidak dapat melakukan boot',
    description: 'Komputer berhenti sebelum sistem operasi selesai dimuat.',
    impact: 'Satu workstation tidak dapat dipakai.',
    blocksLaboratoryOperation: false,
    stepsTaken: 'Kabel daya sudah diperiksa.',
    status: 'assigned',
    assignee: { membershipId: assigneeMembershipId, userId: assigneeUserId, name: 'Teknisi UAT' },
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
    ...overrides,
  };
}

function listItem(overrides: Record<string, unknown> = {}) {
  return {
    id: incidentId,
    ticketNumber: 'INC-2026-000001',
    reporter: { userId: reporterUserId, name: 'Pelapor UAT' },
    laboratory: { id: laboratoryId, code: 'LAB-01', name: 'Lab PPLG 1' },
    device: { id: deviceId, deviceCode: 'PC-0001', deviceType: 'desktop_pc' },
    category: 'hardware',
    priority: 'high',
    title: 'Komputer tidak dapat melakukan boot',
    blocksLaboratoryOperation: false,
    status: 'assigned',
    assignee: { userId: assigneeUserId, name: 'Teknisi UAT' },
    version: 4,
    occurredAt: '2026-09-03T00:00:00.000Z',
    reportedAt: '2026-09-03T00:01:00.000Z',
    ...overrides,
  };
}

function comment(overrides: Record<string, unknown> = {}) {
  return {
    id: '01m0r8nsw938c2zcv44zyge807',
    incidentId,
    actor: { userId: reporterUserId, name: 'Pelapor UAT' },
    text: 'Mohon dicek kembali.',
    createdAt: '2026-09-03T00:04:00.000Z',
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: '01m0r8nsw938c2zcv44zyge808',
    incidentId,
    ticketNumber: 'INC-2026-000001',
    actor: { userId: reporterUserId, membershipId: actorMembershipId, name: 'Pelapor UAT' },
    eventType: 'incident.comment_added',
    incidentVersionBefore: 4,
    incidentVersionAfter: 5,
    payload: { text: 'Mohon dicek kembali.' },
    createdAt: '2026-09-03T00:04:00.000Z',
    ...overrides,
  };
}

function pagination() {
  return { page: 1, perPage: 25, total: 1, lastPage: 1 };
}

function apiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: incident() })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: incident() })) as ApiClient['post'],
    put: vi.fn() as ApiClient['put'],
    patch: vi.fn(async () => ({ data: incident() })) as ApiClient['patch'],
    delete: vi.fn() as ApiClient['delete'],
    ...overrides,
  };
}

describe('Incident contract parser', () => {
  it('accepts the canonical full Incident DTO and snapshot fields', () => {
    const parsed = parseIncidentResponse({ data: incident() });
    expect(parsed.id).toBe(incidentId);
    expect(parsed.assignee?.membershipId).toBe(assigneeMembershipId);
    expect(parsed.laboratory.code).toBe('LAB-01');
    expect(parsed.device?.deviceCode).toBe('PC-0001');
    expect(parsed.version).toBe(4);
  });

  it.each([
    { ...incident(), unexpected: true },
    { ...incident(), status: 'Menunggu Spare Part' },
    { ...incident(), version: 0 },
    { ...incident(), updatedAt: 'not-a-date' },
    { ...incident(), assignee: { membershipId: assigneeMembershipId, userId: assigneeUserId, name: 'Teknisi', role: 'teknisi' } },
  ])('rejects malformed or expanded full Incident DTOs', (value) => {
    expect(() => parseIncidentResponse({ data: value })).toThrow(IncidentContractError);
  });

  it('parses list metadata and rejects expanded list rows or invalid pagination', () => {
    expect(parseIncidentListResponse({ data: [listItem()], meta: pagination() }).meta.total).toBe(1);
    expect(() => parseIncidentListResponse({ data: [{ ...listItem(), description: 'leak' }], meta: pagination() })).toThrow(IncidentContractError);
    expect(() => parseIncidentListResponse({ data: [], meta: { ...pagination(), cursor: null } })).toThrow(IncidentContractError);
  });

  it('keeps participant comments redacted from membership and raw payload evidence', () => {
    const parsed = parseIncidentCommentCollectionResponse({ data: [comment()], meta: pagination() });
    expect(parsed.data[0].actor).toEqual({ userId: reporterUserId, name: 'Pelapor UAT' });
    expect(() => parseIncidentCommentCollectionResponse({
      data: [comment({ actor: { userId: reporterUserId, membershipId: actorMembershipId, name: 'Pelapor UAT' } })],
      meta: pagination(),
    })).toThrow(IncidentContractError);
    expect(() => parseIncidentCommentCollectionResponse({
      data: [comment({ payload: { text: 'raw' } })],
      meta: pagination(),
    })).toThrow(IncidentContractError);
  });

  it('parses full internal events and rejects invalid version pairs or event expansion', () => {
    const parsed = parseIncidentEventCollectionResponse({ data: [event()], meta: pagination() });
    expect(parsed.data[0].actor.membershipId).toBe(actorMembershipId);
    expect(parsed.data[0].payload).toEqual({ text: 'Mohon dicek kembali.' });
    expect(() => parseIncidentEventCollectionResponse({ data: [event({ incidentVersionAfter: 7 })], meta: pagination() })).toThrow(IncidentContractError);
    expect(() => parseIncidentEventCollectionResponse({ data: [event({ eventType: 'incident.deleted' })], meta: pagination() })).toThrow(IncidentContractError);
  });
});

describe('Incident gateway boundary', () => {
  it('builds canonical list filters without leaking local-only fields', async () => {
    const get = vi.fn(async () => ({ data: [listItem()], meta: pagination() })) as ApiClient['get'];
    const gateway = createIncidentGateway(apiClient({ get }));

    await gateway.list({ status: 'reported', priority: 'high', search: '  INC-2026  ', page: 2, perPage: 10 });

    expect(get).toHaveBeenCalledWith('/incidents?status=reported&priority=high&search=INC-2026&page=2&perPage=10');
  });

  it('sends only allowlisted create and correction fields with a strong If-Match', async () => {
    const post = vi.fn(async () => ({ data: incident({ status: 'reported', version: 1, assignee: null, triageSummary: null, assignedAt: null }) })) as ApiClient['post'];
    const patch = vi.fn(async () => ({ data: incident({ status: 'reported', version: 5, assignee: null, triageSummary: null, assignedAt: null }) })) as ApiClient['patch'];
    const gateway = createIncidentGateway(apiClient({ post, patch }));

    await gateway.create({
      submissionId: '00000000-0000-4000-8000-000000000001',
      laboratoryId,
      deviceId,
      category: 'hardware',
      priority: 'high',
      title: 'Komputer tidak dapat melakukan boot',
      description: 'Komputer berhenti sebelum sistem operasi selesai dimuat.',
      impact: null,
      blocksLaboratoryOperation: false,
      stepsTaken: null,
      occurredAt: '2026-09-03T00:00:00.000Z',
    });
    await gateway.update(incidentId, 4, { title: 'Judul baru', priority: 'critical' });

    expect(post).toHaveBeenCalledWith('/incidents', {
      submissionId: '00000000-0000-4000-8000-000000000001',
      laboratoryId,
      deviceId,
      category: 'hardware',
      priority: 'high',
      title: 'Komputer tidak dapat melakukan boot',
      description: 'Komputer berhenti sebelum sistem operasi selesai dimuat.',
      impact: null,
      blocksLaboratoryOperation: false,
      stepsTaken: null,
      occurredAt: '2026-09-03T00:00:00.000Z',
    });
    expect(patch).toHaveBeenCalledWith('/incidents/01m0r8nsw938c2zcv44zyge800', { title: 'Judul baru', priority: 'critical' }, { ifMatch: '"4"' });
  });

  it('uses the dedicated assignment, transition, comment, and history surfaces', async () => {
    const get = vi.fn(async (path: string) => {
      if (path.includes('/comments')) return { data: [comment()], meta: pagination() };
      if (path.includes('/events')) return { data: [event()], meta: pagination() };
      return { data: incident() };
    }) as ApiClient['get'];
    const post = vi.fn(async (path: string) => {
      if (path.includes('/comments')) return { data: comment() };
      return { data: incident() };
    }) as ApiClient['post'];
    const gateway = createIncidentGateway(apiClient({ get, post }));

    await gateway.assign(incidentId, 4, { assigneeMembershipId, reason: 'Pindah teknisi.' });
    await gateway.transition(incidentId, 4, { toStatus: 'in_progress' });
    await gateway.addComment(incidentId, 4, 'Komentar baru.');
    await gateway.comments(incidentId, { page: 2, perPage: 10 });
    await gateway.events(incidentId, { page: 3, perPage: 25 });

    expect(post).toHaveBeenCalledWith(`/incidents/${incidentId}/assignments`, { assigneeMembershipId, reason: 'Pindah teknisi.' }, { ifMatch: '"4"' });
    expect(post).toHaveBeenCalledWith(`/incidents/${incidentId}/transitions`, { toStatus: 'in_progress' }, { ifMatch: '"4"' });
    expect(post).toHaveBeenCalledWith(`/incidents/${incidentId}/comments`, { text: 'Komentar baru.' }, { ifMatch: '"4"' });
    expect(get).toHaveBeenCalledWith(`/incidents/${incidentId}/comments?page=2&perPage=10`);
    expect(get).toHaveBeenCalledWith(`/incidents/${incidentId}/events?page=3&perPage=25`);
  });

  it('uses narrow reporting discovery, assignee discovery, and submission recovery endpoints', async () => {
    const get = vi.fn(async (path: string) => {
      if (path.startsWith('/incidents/reporting-context/laboratories?')) {
        return { data: [{ id: laboratoryId, code: 'LAB-01', name: 'Lab PPLG 1' }], meta: pagination() };
      }
      if (path.includes('/devices?')) {
        return { data: [{ id: deviceId, deviceCode: 'PC-0001', deviceType: 'desktop_pc' }], meta: { hasMore: false } };
      }
      if (path.startsWith('/incidents/assignee-candidates')) {
        return { data: [{ membershipId: assigneeMembershipId, user: { id: assigneeUserId, name: 'Teknisi UAT' } }], meta: pagination() };
      }
      return { data: incident() };
    }) as ApiClient['get'];
    const gateway = createIncidentGateway(apiClient({ get }));

    await gateway.reportingLaboratories({ search: '  LAB  ', page: 1, perPage: 25 });
    await gateway.reportingDevices(laboratoryId, ' PC-00 ');
    await gateway.assigneeCandidates({ search: ' Teknisi ', page: 1 });
    await gateway.recoverSubmission('00000000-0000-4000-8000-000000000001');

    expect(get).toHaveBeenCalledWith('/incidents/reporting-context/laboratories?search=LAB&page=1&perPage=25');
    expect(get).toHaveBeenCalledWith(`/incidents/reporting-context/laboratories/${laboratoryId}/devices?search=PC-00`);
    expect(get).toHaveBeenCalledWith('/incidents/assignee-candidates?search=Teknisi&page=1');
    expect(get).toHaveBeenCalledWith('/incidents/submissions/00000000-0000-4000-8000-000000000001');
  });

  it('fails closed before issuing network calls for empty identifiers, bad versions, or invalid Device discovery search', async () => {
    const api = apiClient();
    const gateway = createIncidentGateway(api);

    await expect(gateway.show('   ')).rejects.toThrow(IncidentContractError);
    await expect(gateway.update(incidentId, 0, { title: 'x' })).rejects.toThrow(IncidentContractError);
    await expect(gateway.update(incidentId, 1, {})).rejects.toThrow(IncidentContractError);
    await expect(gateway.reportingDevices(laboratoryId, 'x')).rejects.toThrow(IncidentContractError);

    expect(api.get).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });
});
