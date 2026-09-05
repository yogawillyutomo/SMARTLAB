import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  createScheduleExceptionGateway,
  parseScheduleException,
  ScheduleExceptionContractError,
} from '@/services/scheduleExceptionApi';

const ids = {
  exception: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  school: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  occurrence: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  publication: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  originalLab: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  replacementLab: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
  user: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
  membership: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
  teacher: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
  academicClass: '01ARZ3NDEKTSV4RRFFQ69G5FB4',
  subject: '01ARZ3NDEKTSV4RRFFQ69G5FB5',
};

const exception = {
  id: ids.exception,
  schoolId: ids.school,
  occurrenceId: ids.occurrence,
  publicationId: ids.publication,
  sourcePublicationId: 'TT-1',
  sourceVersion: 2,
  sourceScheduleId: 'SCH-1',
  occursOn: '2026-09-14',
  resolution: 'relocate' as const,
  status: 'active' as const,
  originalLaboratory: { id: ids.originalLab, code: 'LAB-1', name: 'Lab 1', capacity: 36, status: 'active' as const },
  replacementLaboratory: { id: ids.replacementLab, code: 'LAB-2', name: 'Lab 2', capacity: 40, status: 'active' as const },
  reason: 'Maintenance',
  approvedBy: { userId: ids.user, membershipId: ids.membership, name: 'Admin Lab' },
  version: 1,
  cancelledAt: null,
  createdAt: '2026-09-05T01:00:00.000Z',
  updatedAt: '2026-09-05T01:00:00.000Z',
  sourceOccurrence: {
    id: ids.occurrence,
    date: '2026-09-14',
    startsAt: '07:00:00',
    endsAt: '08:45:00',
    activityType: 'practical' as const,
    teacher: { id: ids.teacher, code: 'T-1', name: 'Guru A' },
    academicClass: { id: ids.academicClass, code: 'XI-PPLG-1', name: 'XI PPLG 1' },
    subject: { id: ids.subject, code: 'WEB', name: 'Pemrograman Web' },
  },
  timeline: [{
    eventType: 'schedule_exception.applied' as const,
    actorName: 'Admin Lab',
    at: '2026-09-05T01:00:00.000Z',
    payload: {},
    versionBefore: 0,
    versionAfter: 1,
  }],
};

function client(post: ApiClient['post'], get: ApiClient['get'] = vi.fn() as ApiClient['get']): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get,
    post,
    put: vi.fn() as ApiClient['put'],
    patch: vi.fn() as ApiClient['patch'],
    delete: vi.fn() as ApiClient['delete'],
  };
}

describe('schedule exception API contract', () => {
  it('parses relocate and rejects invalid resolution shapes', () => {
    expect(parseScheduleException(exception)).toEqual(exception);
    expect(() => parseScheduleException({ ...exception, resolution: 'cancel', replacementLaboratory: exception.replacementLaboratory }))
      .toThrow(ScheduleExceptionContractError);
    expect(() => parseScheduleException({ ...exception, resolution: 'relocate', replacementLaboratory: null }))
      .toThrow(ScheduleExceptionContractError);
  });

  it('creates and cancels with exact payload and If-Match version', async () => {
    const post = vi.fn(async () => ({ data: exception })) as ApiClient['post'];
    const gateway = createScheduleExceptionGateway(client(post));

    await gateway.create({
      occurrenceId: ids.occurrence,
      resolution: 'relocate',
      replacementLaboratoryId: ids.replacementLab,
      reason: ' Maintenance ',
    });
    await gateway.cancel(ids.exception, 1, ' Sumber siap kembali ');

    expect(post).toHaveBeenNthCalledWith(1, '/schedule-exceptions', {
      occurrenceId: ids.occurrence,
      resolution: 'relocate',
      replacementLaboratoryId: ids.replacementLab,
      reason: 'Maintenance',
    });
    expect(post).toHaveBeenNthCalledWith(
      2,
      `/schedule-exceptions/${ids.exception}/cancel`,
      { reason: 'Sumber siap kembali' },
      { ifMatch: '"1"' },
    );
  });
});
