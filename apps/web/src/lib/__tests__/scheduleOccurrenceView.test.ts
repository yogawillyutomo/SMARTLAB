import { describe, expect, it } from 'vitest';
import {
  activityLabel,
  datesForWeek,
  moveWeek,
  occurrencesForDate,
  weekStartForDate,
} from '@/lib/scheduleOccurrenceView';
import type { ScheduleOccurrenceDto } from '@/services/scheduleOccurrenceApi';

const base: ScheduleOccurrenceDto = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  schoolId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  publicationId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  sourcePublicationId: 'TT-2026-GASAL',
  sourceVersion: 1,
  sourceScheduleId: 'SCH-1',
  occursOn: '2026-09-07',
  activityType: 'practical',
  teacher: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAY', code: 'T-A', name: 'Guru A' },
  academicClass: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAZ', code: 'XI-PPLG-1', name: 'XI PPLG 1' },
  subject: { id: '01ARZ3NDEKTSV4RRFFQ69G5FB0', code: 'WEB', name: 'Pemrograman Web' },
  plannedLaboratory: { id: '01ARZ3NDEKTSV4RRFFQ69G5FB1', code: 'LAB-1', name: 'Lab 1' },
  operationalStatus: 'scheduled',
  operationalLaboratory: { id: '01ARZ3NDEKTSV4RRFFQ69G5FB1', code: 'LAB-1', name: 'Lab 1' },
  exception: null,
  lessonPeriodSetId: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
  startLessonPeriodId: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
  endLessonPeriodId: '01ARZ3NDEKTSV4RRFFQ69G5FB4',
  startTime: '07:00:00',
  endTime: '08:45:00',
  instructionPeriodCount: 2,
};

describe('canonical Schedule Occurrence week projection', () => {
  it('uses Monday as week start and never hides Saturday or Sunday', () => {
    expect(weekStartForDate(new Date(2026, 8, 10))).toBe('2026-09-07');
    expect(datesForWeek('2026-09-07').map((date) => [date.label, date.key])).toEqual([
      ['Senin', '2026-09-07'],
      ['Selasa', '2026-09-08'],
      ['Rabu', '2026-09-09'],
      ['Kamis', '2026-09-10'],
      ['Jumat', '2026-09-11'],
      ['Sabtu', '2026-09-12'],
      ['Minggu', '2026-09-13'],
    ]);
  });

  it('moves by complete local calendar weeks', () => {
    expect(moveWeek('2026-09-07', -1)).toBe('2026-08-31');
    expect(moveWeek('2026-09-07', 1)).toBe('2026-09-14');
  });

  it('filters by immutable occurrence date and sorts by start time', () => {
    const early = { ...base, id: '01ARZ3NDEKTSV4RRFFQ69G5FC0', startTime: '06:30:00' };
    const later = { ...base, id: '01ARZ3NDEKTSV4RRFFQ69G5FC1', startTime: '09:00:00' };
    const otherDate = { ...base, id: '01ARZ3NDEKTSV4RRFFQ69G5FC2', occursOn: '2026-09-08' };

    expect(occurrencesForDate([later, otherDate, early], '2026-09-07').map((item) => item.id))
      .toEqual([early.id, later.id]);
  });

  it('maps source activity types to product labels', () => {
    expect(activityLabel('practical')).toBe('Praktikum');
    expect(activityLabel('theory')).toBe('Teori');
    expect(activityLabel('exam')).toBe('Ujian');
    expect(activityLabel('other')).toBe('Lainnya');
  });
});
