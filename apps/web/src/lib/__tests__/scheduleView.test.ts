import { describe, expect, it } from 'vitest';
import {
  activeRegularSchedules,
  defaultRegularScheduleWeekday,
  regularScheduleDistribution,
  regularScheduleAppliesOnDate,
  schedulesForWeekday,
} from '@/lib/scheduleView';
import type { Schedule } from '@/types';

function schedule(id: string, day: string, startTime: string, lessonHours = 2, date = '2026-08-17'): Schedule {
  return {
    id,
    day,
    date,
    startTime,
    endTime: '10:00',
    lessonHours,
    laboratoryId: 'lab-1',
    className: 'XI RPL 1',
    teacherName: 'Guru',
    subject: 'Pemrograman',
    activityType: 'Praktikum',
    status: 'Tetap',
    semester: 'Gasal',
  };
}

describe('regular schedule weekday projection', () => {
  it('uses the current school weekday and falls back to Senin on weekends', () => {
    expect(defaultRegularScheduleWeekday(new Date(2026, 7, 21))).toBe('Jumat');
    expect(defaultRegularScheduleWeekday(new Date(2026, 7, 22))).toBe('Senin');
  });

  it('filters the selected day and returns schedules in stable start-time order', () => {
    const first = schedule('first', 'Senin', '07:00');
    const sameTime = schedule('same-time', 'Senin', '07:00');
    const later = schedule('later', 'Senin', '09:00');
    const otherDay = schedule('other-day', 'Selasa', '06:30');

    expect(schedulesForWeekday([later, first, otherDay, sameTime], 'Senin').map((item) => item.id))
      .toEqual(['first', 'same-time', 'later']);
  });

  it('groups persisted schedules by weekday with truthful counts and total JP', () => {
    const distribution = regularScheduleDistribution([
      schedule('monday-1', 'Senin', '07:00', 3),
      schedule('monday-2', 'Senin', '10:00', 2),
      schedule('friday', 'Jumat', '08:00', 4),
    ]);

    expect(distribution).toEqual([
      { day: 'Senin', scheduleCount: 2, lessonHours: 5 },
      { day: 'Selasa', scheduleCount: 0, lessonHours: 0 },
      { day: 'Rabu', scheduleCount: 0, lessonHours: 0 },
      { day: 'Kamis', scheduleCount: 0, lessonHours: 0 },
      { day: 'Jumat', scheduleCount: 1, lessonHours: 4 },
    ]);
  });

  it('uses the recurring weekday and never lets Schedule.date override it', () => {
    const friday = new Date(2026, 7, 21);
    expect(regularScheduleAppliesOnDate(schedule('weekday', 'Jumat', '07:00', 2, '2026-01-01'), friday)).toBe(true);
    expect(regularScheduleAppliesOnDate(schedule('mismatch', 'Senin', '07:00', 2, '2026-08-21'), friday)).toBe(false);
    expect(regularScheduleAppliesOnDate(schedule('other', 'Senin', '07:00', 2, '2026-01-01'), friday)).toBe(false);
  });

  it('excludes cancelled schedules from operational regular-schedule projections', () => {
    const cancelled = { ...schedule('cancelled', 'Jumat', '07:00'), status: 'Dibatalkan' as const };
    expect(activeRegularSchedules([schedule('active', 'Jumat', '08:00'), cancelled]).map((item) => item.id)).toEqual(['active']);
  });
});
