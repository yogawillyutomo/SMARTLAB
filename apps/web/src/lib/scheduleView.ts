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

export function regularScheduleConflictMessages(schedules: readonly Schedule[], input: Partial<Schedule>, excludeId?: string): string[] {
  const { day, startTime, endTime, status } = input;
  if (status === 'Dibatalkan' || !day || !startTime || !endTime) return [];

  const conflicts: string[] = [];
  schedules.forEach((schedule) => {
    if (schedule.id === excludeId || schedule.status === 'Dibatalkan' || schedule.day !== day) return;
    if (schedule.startTime < endTime && schedule.endTime > startTime) {
      if (schedule.laboratoryId === input.laboratoryId) conflicts.push(`Bentrok lab dengan ${schedule.className} (${schedule.startTime}-${schedule.endTime})`);
      if (schedule.teacherName === input.teacherName) conflicts.push(`Guru ${schedule.teacherName} sudah mengajar ${schedule.className}`);
      if (schedule.className === input.className) conflicts.push(`Kelas ${schedule.className} sudah di jadwal lain`);
    }
  });
  return conflicts;
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

export function activeRegularSchedules(schedules: readonly Schedule[]): Schedule[] {
  return schedules.filter((schedule) => schedule.status !== 'Dibatalkan');
}

/** Regular schedules recur by weekday; Schedule.date is retained historical data, not an override. */
export function regularScheduleAppliesOnDate(schedule: Schedule, date: Date): boolean {
  return schedule.day === scheduleWeekdayForDate(date);
}
