import type { Schedule } from '@/types';

export const REGULAR_SCHEDULE_WEEKDAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'] as const;

export type RegularScheduleWeekday = (typeof REGULAR_SCHEDULE_WEEKDAYS)[number];

const INDONESIAN_WEEKDAYS = ['Minggu', ...REGULAR_SCHEDULE_WEEKDAYS, 'Sabtu'] as const;

export function scheduleWeekdayForDate(date: Date): string {
  return INDONESIAN_WEEKDAYS[date.getDay()];
}

export function defaultRegularScheduleWeekday(date = new Date()): RegularScheduleWeekday {
  const weekday = scheduleWeekdayForDate(date);
  return REGULAR_SCHEDULE_WEEKDAYS.find((candidate) => candidate === weekday) ?? 'Senin';
}

export function schedulesForWeekday(schedules: readonly Schedule[], weekday: RegularScheduleWeekday): Schedule[] {
  return schedules
    .filter((schedule) => schedule.day === weekday)
    .sort((left, right) => left.startTime.localeCompare(right.startTime));
}

export function regularScheduleDistribution(schedules: readonly Schedule[]) {
  return REGULAR_SCHEDULE_WEEKDAYS.map((weekday) => {
    const projected = schedulesForWeekday(schedules, weekday);
    return {
      day: weekday,
      scheduleCount: projected.length,
      lessonHours: projected.reduce((total, schedule) => total + schedule.lessonHours, 0),
    };
  });
}

export function scheduleAppliesOnDate(schedule: Schedule, date: Date): boolean {
  const localDate = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  return schedule.date === localDate || schedule.day === scheduleWeekdayForDate(date);
}
