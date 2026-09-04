import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  ScheduleOccurrenceContractError,
  buildScheduleOccurrenceListPath,
  createScheduleOccurrenceGateway,
  parseScheduleOccurrence,
  parseScheduleOccurrencePage,
} from '@/services/scheduleOccurrenceApi';

const ids = {
  occurrence: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  school: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  publication: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  teacher: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  academicClass: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  subject: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
  laboratory: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
  periodSet: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
  startPeriod: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
  endPeriod: '01ARZ3NDEKTSV4RRFFQ69G5FB4',
};

const occurrence = {
  id: ids.occurrence,
  schoolId: ids.school,
  publicationId: ids.publication,
  sourcePublicationId: 'TT-2026-GASAL',
  sourceVersion: 2,
  sourceScheduleId: 'SCH-XIPPLG1-WEB-MON-01',
  occursOn: '2026-09-07',
  activityType: 'practical' as const,
  teacher: { id: ids.teacher, code: 'T-A', name: 'Guru A' },
  academicClass: { id: ids.academicClass, code: 'XI-PPLG-1', name: 'XI PPLG 1' },
  subject: { id: ids.subject, code: 'WEB', name: 'Pemrograman Web' },
  plannedLaboratory: { id: ids.laboratory, code: 'LAB-RPL-1', name: 'Lab RPL 1' },
  lessonPeriodSetId: ids.periodSet,
  startLessonPeriodId: ids.startPeriod,
  endLessonPeriodId: ids.endPeriod,
  startTime: '07:00:00',
  endTime: '08:45:00',
  instructionPeriodCount: 2,
};

const page = {
  data: [occurrence],
  meta: {
    page: 1,
    perPage: 1000,
    total: 1,
    lastPage: 1,
    from: '2026-09-07',
    to: '2026-09-13',
    activePublicationCount: 1,
  },
};

function clientWith(get: ApiClient['get']): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get,
    post: vi.fn() as ApiClient['post'],
    put: vi.fn() as ApiClient['put'],
    patch: vi.fn() as ApiClient['patch'],
    delete: vi.fn() as ApiClient['delete'],
  };
}

describe('Schedule Occurrence response parsing', () => {
  it('parses exact canonical occurrence and pagination envelopes', () => {
    expect(parseScheduleOccurrence(occurrence)).toEqual(occurrence);
    expect(parseScheduleOccurrencePage(page)).toEqual(page);
    expect(parseScheduleOccurrence({ ...occurrence, plannedLaboratory: null }).plannedLaboratory).toBeNull();
  });

  it.each([
    { ...occurrence, id: 'not-an-ulid' },
    { ...occurrence, sourceVersion: 0 },
    { ...occurrence, startTime: '08:45:00', endTime: '07:00:00' },
    { ...occurrence, activityType: 'meeting' },
    { ...occurrence, unexpected: true },
  ])('rejects malformed occurrence payloads', (value) => {
    expect(() => parseScheduleOccurrence(value)).toThrow(ScheduleOccurrenceContractError);
  });

  it('rejects malformed or inconsistent collection metadata', () => {
    expect(() => parseScheduleOccurrencePage({ data: [occurrence], meta: { ...page.meta, lastPage: 0 } }))
      .toThrow(ScheduleOccurrenceContractError);
    expect(() => parseScheduleOccurrencePage({ data: [occurrence], meta: { ...page.meta, activePublicationCount: -1 } }))
      .toThrow(ScheduleOccurrenceContractError);
    expect(() => parseScheduleOccurrencePage({ ...page, extra: true }))
      .toThrow(ScheduleOccurrenceContractError);
  });
});

describe('Schedule Occurrence request boundary', () => {
  it('builds a bounded allowlisted read path', () => {
    const path = buildScheduleOccurrenceListPath({
      from: '2026-09-07',
      to: '2026-09-13',
      laboratoryId: ids.laboratory,
      teacherId: ids.teacher,
      academicClassId: ids.academicClass,
      subjectId: ids.subject,
      activityType: 'practical',
      page: 2,
      perPage: 250,
    });

    const url = new URL(`https://smartlab.test${path}`);
    expect(url.pathname).toBe('/schedule-occurrences');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '2026-09-07',
      to: '2026-09-13',
      laboratoryId: ids.laboratory,
      teacherId: ids.teacher,
      academicClassId: ids.academicClass,
      subjectId: ids.subject,
      activityType: 'practical',
      page: '2',
      perPage: '250',
    });
  });

  it('rejects invalid or oversized ranges before network access', () => {
    expect(() => buildScheduleOccurrenceListPath({ from: '2026-09-07', to: '2026-09-06' }))
      .toThrow(ScheduleOccurrenceContractError);
    expect(() => buildScheduleOccurrenceListPath({ from: '2026-09-01', to: '2026-09-15' }))
      .toThrow(ScheduleOccurrenceContractError);
    expect(() => buildScheduleOccurrenceListPath({ from: '2026-02-30', to: '2026-03-01' }))
      .toThrow(ScheduleOccurrenceContractError);
  });

  it('reads the exact endpoint and listAll returns a complete canonical week', async () => {
    const get = vi.fn(async () => page) as ApiClient['get'];
    const gateway = createScheduleOccurrenceGateway(clientWith(get));

    await expect(gateway.listAll({ from: '2026-09-07', to: '2026-09-13' })).resolves.toEqual({
      data: [occurrence],
      meta: {
        total: 1,
        from: '2026-09-07',
        to: '2026-09-13',
        activePublicationCount: 1,
      },
    });

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/schedule-occurrences?from=2026-09-07&to=2026-09-13&page=1&perPage=1000');
  });
});
