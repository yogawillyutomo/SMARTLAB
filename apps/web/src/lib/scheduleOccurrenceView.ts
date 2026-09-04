import { ApiClientError } from '@/lib/apiClient';
import { ScheduleOccurrenceContractError, type ScheduleActivityType, type ScheduleOccurrenceDto } from '@/services/scheduleOccurrenceApi';

export const SCHEDULE_WEEKDAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'] as const;

export interface ScheduleWeekDate {
  key: string;
  label: string;
  shortLabel: string;
}

export interface ScheduleOccurrencePresentationIssue {
  message: string;
  retryable: boolean;
  authBoundary: boolean;
}

export function dateKeyForDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function weekStartForDate(date: Date): string {
  const cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const isoWeekday = cursor.getDay() === 0 ? 7 : cursor.getDay();
  cursor.setDate(cursor.getDate() - (isoWeekday - 1));
  return dateKeyForDate(cursor);
}

export function moveWeek(weekStart: string, deltaWeeks: number): string {
  const date = parseLocalDateKey(weekStart);
  date.setDate(date.getDate() + (deltaWeeks * 7));
  return dateKeyForDate(date);
}

export function datesForWeek(weekStart: string): ScheduleWeekDate[] {
  const start = parseLocalDateKey(weekStart);
  return SCHEDULE_WEEKDAYS.map((weekday, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return {
      key: dateKeyForDate(date),
      label: weekday,
      shortLabel: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' }).format(date),
    };
  });
}

export function formatScheduleWeekRange(weekStart: string): string {
  const dates = datesForWeek(weekStart);
  const first = parseLocalDateKey(dates[0].key);
  const last = parseLocalDateKey(dates[6].key);
  const formatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${formatter.format(first)} – ${formatter.format(last)}`;
}

export function occurrencesForDate(
  occurrences: readonly ScheduleOccurrenceDto[],
  dateKey: string,
): ScheduleOccurrenceDto[] {
  return occurrences
    .filter((occurrence) => occurrence.occursOn === dateKey)
    .sort((left, right) => left.startTime.localeCompare(right.startTime) || left.id.localeCompare(right.id));
}

export function activityLabel(activityType: ScheduleActivityType): string {
  return {
    practical: 'Praktikum',
    theory: 'Teori',
    exam: 'Ujian',
    other: 'Lainnya',
  }[activityType];
}

export function scheduleOccurrencePresentationIssue(error: unknown): ScheduleOccurrencePresentationIssue {
  const fallback: ScheduleOccurrencePresentationIssue = {
    message: 'Jadwal canonical tidak dapat dimuat. Silakan coba lagi.',
    retryable: true,
    authBoundary: false,
  };

  if (error instanceof ScheduleOccurrenceContractError) {
    return { ...fallback, message: 'Respons jadwal dari server tidak sesuai kontrak yang diharapkan.' };
  }
  if (!(error instanceof ApiClientError)) return fallback;

  if (error.status === 401 || error.code === 'UNAUTHENTICATED') {
    return {
      message: 'Sesi Anda telah berakhir. Memeriksa ulang sesi...',
      retryable: false,
      authBoundary: true,
    };
  }
  if (error.status === 403 || error.code === 'FORBIDDEN') {
    return { ...fallback, message: 'Anda tidak memiliki izin untuk melihat jadwal ini.', retryable: false };
  }
  if (error.code === 'ACTIVE_MEMBERSHIP_REQUIRED' || error.code === 'SCHOOL_CONTEXT_REQUIRED') {
    return {
      message: 'Konteks sekolah aktif tidak tersedia. Memeriksa ulang sesi...',
      retryable: false,
      authBoundary: true,
    };
  }
  if (error.status === 422 || error.code === 'VALIDATION_FAILED') {
    return { ...fallback, message: 'Rentang atau filter jadwal tidak valid.', retryable: false };
  }
  if (error.kind === 'configuration') {
    return { ...fallback, message: 'Konfigurasi API jadwal tidak valid.', retryable: false };
  }
  if (error.kind === 'network') {
    return { ...fallback, message: 'Layanan jadwal tidak dapat dijangkau. Periksa koneksi lalu coba lagi.' };
  }
  if (error.kind === 'invalid_response') {
    return { ...fallback, message: 'Server mengembalikan respons jadwal yang tidak valid.' };
  }
  if (error.status !== undefined && error.status >= 500) {
    return { ...fallback, message: 'Server jadwal sedang bermasalah. Silakan coba lagi.' };
  }

  return fallback;
}
