import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export type ScheduleActivityType = 'practical' | 'theory' | 'exam' | 'other';

export interface ScheduleReferenceDto {
  id: string;
  code: string;
  name: string;
}

export interface ScheduleOccurrenceDto {
  id: string;
  schoolId: string;
  publicationId: string;
  sourcePublicationId: string;
  sourceVersion: number;
  sourceScheduleId: string;
  occursOn: string;
  activityType: ScheduleActivityType;
  teacher: ScheduleReferenceDto;
  academicClass: ScheduleReferenceDto;
  subject: ScheduleReferenceDto;
  plannedLaboratory: ScheduleReferenceDto | null;
  lessonPeriodSetId: string;
  startLessonPeriodId: string;
  endLessonPeriodId: string;
  startTime: string;
  endTime: string;
  instructionPeriodCount: number;
}

export interface ScheduleOccurrenceMeta {
  page: number;
  perPage: number;
  total: number;
  lastPage: number;
  from: string;
  to: string;
  activePublicationCount: number;
}

export interface ScheduleOccurrencePage {
  data: ScheduleOccurrenceDto[];
  meta: ScheduleOccurrenceMeta;
}

export interface ScheduleOccurrenceResult {
  data: ScheduleOccurrenceDto[];
  meta: Omit<ScheduleOccurrenceMeta, 'page' | 'perPage' | 'lastPage'>;
}

export interface ScheduleOccurrenceFilters {
  from: string;
  to: string;
  laboratoryId?: string;
  teacherId?: string;
  academicClassId?: string;
  subjectId?: string;
  activityType?: ScheduleActivityType;
  page?: number;
  perPage?: number;
}

export interface ScheduleOccurrenceGateway {
  list: (filters: ScheduleOccurrenceFilters) => Promise<ScheduleOccurrencePage>;
  listAll: (filters: Omit<ScheduleOccurrenceFilters, 'page' | 'perPage'>) => Promise<ScheduleOccurrenceResult>;
}

export class ScheduleOccurrenceContractError extends Error {
  constructor(message = 'Respons Schedule Occurrence tidak sesuai kontrak API.') {
    super(message);
    this.name = 'ScheduleOccurrenceContractError';
  }
}

const ACTIVITY_TYPES: readonly ScheduleActivityType[] = ['practical', 'theory', 'exam', 'other'];
const OCCURRENCE_FIELDS = [
  'id',
  'schoolId',
  'publicationId',
  'sourcePublicationId',
  'sourceVersion',
  'sourceScheduleId',
  'occursOn',
  'activityType',
  'teacher',
  'academicClass',
  'subject',
  'plannedLaboratory',
  'lessonPeriodSetId',
  'startLessonPeriodId',
  'endLessonPeriodId',
  'startTime',
  'endTime',
  'instructionPeriodCount',
] as const;
const REFERENCE_FIELDS = ['id', 'code', 'name'] as const;
const META_FIELDS = ['page', 'perPage', 'total', 'lastPage', 'from', 'to', 'activePublicationCount'] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') throw new ScheduleOccurrenceContractError();
  return value;
}

function requiredUlid(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (!isUlid(value)) throw new ScheduleOccurrenceContractError();
  return value;
}

function requiredDate(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (!isValidDateKey(value)) throw new ScheduleOccurrenceContractError();
  return value;
}

function requiredTime(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (!TIME_PATTERN.test(value)) throw new ScheduleOccurrenceContractError();
  return value;
}

function parseReference(value: unknown): ScheduleReferenceDto {
  if (!isRecord(value) || !exactKeys(value, REFERENCE_FIELDS)) throw new ScheduleOccurrenceContractError();
  return {
    id: requiredUlid(value, 'id'),
    code: requiredString(value, 'code'),
    name: requiredString(value, 'name'),
  };
}

function isActivityType(value: unknown): value is ScheduleActivityType {
  return typeof value === 'string' && (ACTIVITY_TYPES as readonly string[]).includes(value);
}

export function isValidDateKey(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function parseScheduleOccurrence(value: unknown): ScheduleOccurrenceDto {
  if (!isRecord(value) || !exactKeys(value, OCCURRENCE_FIELDS)) throw new ScheduleOccurrenceContractError();

  if (!positiveInteger(value.sourceVersion)
    || !positiveInteger(value.instructionPeriodCount)
    || !isActivityType(value.activityType)) {
    throw new ScheduleOccurrenceContractError();
  }

  const plannedLaboratory = value.plannedLaboratory;
  if (plannedLaboratory !== null && !isRecord(plannedLaboratory)) throw new ScheduleOccurrenceContractError();

  const startTime = requiredTime(value, 'startTime');
  const endTime = requiredTime(value, 'endTime');
  if (startTime >= endTime) throw new ScheduleOccurrenceContractError();

  return {
    id: requiredUlid(value, 'id'),
    schoolId: requiredUlid(value, 'schoolId'),
    publicationId: requiredUlid(value, 'publicationId'),
    sourcePublicationId: requiredString(value, 'sourcePublicationId'),
    sourceVersion: value.sourceVersion,
    sourceScheduleId: requiredString(value, 'sourceScheduleId'),
    occursOn: requiredDate(value, 'occursOn'),
    activityType: value.activityType,
    teacher: parseReference(value.teacher),
    academicClass: parseReference(value.academicClass),
    subject: parseReference(value.subject),
    plannedLaboratory: plannedLaboratory === null ? null : parseReference(plannedLaboratory),
    lessonPeriodSetId: requiredUlid(value, 'lessonPeriodSetId'),
    startLessonPeriodId: requiredUlid(value, 'startLessonPeriodId'),
    endLessonPeriodId: requiredUlid(value, 'endLessonPeriodId'),
    startTime,
    endTime,
    instructionPeriodCount: value.instructionPeriodCount,
  };
}

export function parseScheduleOccurrencePage(value: unknown): ScheduleOccurrencePage {
  if (!isRecord(value) || !exactKeys(value, ['data', 'meta']) || !Array.isArray(value.data) || !isRecord(value.meta)) {
    throw new ScheduleOccurrenceContractError('Envelope Schedule Occurrence tidak valid.');
  }
  if (!exactKeys(value.meta, META_FIELDS)) throw new ScheduleOccurrenceContractError('Metadata Schedule Occurrence tidak valid.');

  const { page, perPage, total, lastPage, from, to, activePublicationCount } = value.meta;
  if (!positiveInteger(page)
    || !positiveInteger(perPage)
    || perPage > 1000
    || !nonNegativeInteger(total)
    || !positiveInteger(lastPage)
    || typeof from !== 'string'
    || typeof to !== 'string'
    || !isValidDateKey(from)
    || !isValidDateKey(to)
    || from > to
    || !nonNegativeInteger(activePublicationCount)) {
    throw new ScheduleOccurrenceContractError('Metadata Schedule Occurrence tidak valid.');
  }

  const data = value.data.map(parseScheduleOccurrence);
  if (data.length > perPage || total < data.length || page > lastPage) {
    throw new ScheduleOccurrenceContractError('Metadata Schedule Occurrence tidak konsisten.');
  }

  return {
    data,
    meta: { page, perPage, total, lastPage, from, to, activePublicationCount },
  };
}

function assertDateRange(from: string, to: string): void {
  if (!isValidDateKey(from) || !isValidDateKey(to) || from > to) {
    throw new ScheduleOccurrenceContractError('Rentang tanggal jadwal tidak valid.');
  }

  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const first = Date.UTC(fy, fm - 1, fd);
  const last = Date.UTC(ty, tm - 1, td);
  if ((last - first) / 86_400_000 > 13) {
    throw new ScheduleOccurrenceContractError('Rentang jadwal maksimal 14 hari.');
  }
}

function optionalId(parameters: URLSearchParams, key: string, value: string | undefined): void {
  if (value === undefined) return;
  if (value.trim() === '') throw new ScheduleOccurrenceContractError(`Filter ${key} tidak valid.`);
  parameters.set(key, value);
}

export function buildScheduleOccurrenceListPath(filters: ScheduleOccurrenceFilters): string {
  assertDateRange(filters.from, filters.to);
  const parameters = new URLSearchParams({ from: filters.from, to: filters.to });

  optionalId(parameters, 'laboratoryId', filters.laboratoryId);
  optionalId(parameters, 'teacherId', filters.teacherId);
  optionalId(parameters, 'academicClassId', filters.academicClassId);
  optionalId(parameters, 'subjectId', filters.subjectId);

  if (filters.activityType !== undefined) {
    if (!isActivityType(filters.activityType)) throw new ScheduleOccurrenceContractError('Jenis kegiatan tidak valid.');
    parameters.set('activityType', filters.activityType);
  }
  if (filters.page !== undefined) {
    if (!positiveInteger(filters.page)) throw new ScheduleOccurrenceContractError('Halaman jadwal tidak valid.');
    parameters.set('page', String(filters.page));
  }
  if (filters.perPage !== undefined) {
    if (!positiveInteger(filters.perPage) || filters.perPage > 1000) {
      throw new ScheduleOccurrenceContractError('Ukuran halaman jadwal tidak valid.');
    }
    parameters.set('perPage', String(filters.perPage));
  }

  return `/schedule-occurrences?${parameters.toString()}`;
}

export function createScheduleOccurrenceGateway(client: ApiClient): ScheduleOccurrenceGateway {
  const list: ScheduleOccurrenceGateway['list'] = async (filters) => (
    parseScheduleOccurrencePage(await client.get<unknown>(buildScheduleOccurrenceListPath(filters)))
  );

  return {
    list,

    async listAll(filters) {
      const first = await list({ ...filters, page: 1, perPage: 1000 });
      const pages = [first];
      if (first.meta.lastPage > 20) {
        throw new ScheduleOccurrenceContractError('Rentang jadwal terlalu besar untuk ditampilkan dengan aman.');
      }

      for (let page = 2; page <= first.meta.lastPage; page += 1) {
        const next = await list({ ...filters, page, perPage: 1000 });
        if (next.meta.from !== first.meta.from
          || next.meta.to !== first.meta.to
          || next.meta.total !== first.meta.total
          || next.meta.lastPage !== first.meta.lastPage
          || next.meta.activePublicationCount !== first.meta.activePublicationCount) {
          throw new ScheduleOccurrenceContractError('Pagination Schedule Occurrence berubah selama pembacaan.');
        }
        pages.push(next);
      }

      const data = pages.flatMap((page) => page.data);
      if (data.length !== first.meta.total) {
        throw new ScheduleOccurrenceContractError('Koleksi Schedule Occurrence tidak lengkap.');
      }

      return {
        data,
        meta: {
          total: first.meta.total,
          from: first.meta.from,
          to: first.meta.to,
          activePublicationCount: first.meta.activePublicationCount,
        },
      };
    },
  };
}

export const scheduleOccurrenceGateway = createScheduleOccurrenceGateway(apiClient);
