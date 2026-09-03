import { apiClient, type ApiClient } from '@/lib/apiClient';

export const ACADEMIC_MASTER_STATUSES = ['active', 'inactive'] as const;
export const ACADEMIC_UNIT_TYPES = ['department', 'program', 'concentration', 'other'] as const;
export const LESSON_PERIOD_KINDS = ['instruction', 'break'] as const;

export type AcademicMasterStatus = (typeof ACADEMIC_MASTER_STATUSES)[number];
export type AcademicUnitType = (typeof ACADEMIC_UNIT_TYPES)[number];
export type LessonPeriodKind = (typeof LESSON_PERIOD_KINDS)[number];

export interface AcademicMasterPage<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; lastPage: number };
}

interface BaseDto {
  id: string;
  schoolId: string;
  code: string;
  status: AcademicMasterStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AcademicUnitDto extends BaseDto {
  name: string;
  type: AcademicUnitType;
  parentId: string | null;
}

export interface TeacherDto extends BaseDto {
  personnelNumber: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  academicUnitId: string | null;
  membershipId: string | null;
}

export interface AcademicClassDto extends BaseDto {
  name: string;
  gradeLevel: number;
  academicUnitId: string | null;
  homeroomTeacherId: string | null;
  studentCount: number;
}

export interface SubjectDto extends BaseDto {
  name: string;
  groupName: string | null;
  academicUnitId: string | null;
}

export interface AcademicYearDto extends BaseDto {
  name: string;
  startsOn: string;
  endsOn: string;
}

export interface SemesterDto extends BaseDto {
  academicYearId: string;
  name: string;
  startsOn: string;
  endsOn: string;
}

export interface LessonPeriodSetDto extends BaseDto {
  academicYearId: string;
  name: string;
}

export interface LessonPeriodDto extends BaseDto {
  lessonPeriodSetId: string;
  sequence: number;
  startsAt: string;
  endsAt: string;
  kind: LessonPeriodKind;
}

export interface ListFilters {
  search?: string;
  status?: AcademicMasterStatus;
  page?: number;
  perPage?: number;
  parentId?: string | null;
  type?: AcademicUnitType;
  academicUnitId?: string | null;
  membershipId?: string | null;
  homeroomTeacherId?: string | null;
  gradeLevel?: number;
  academicYearId?: string;
  lessonPeriodSetId?: string;
  kind?: LessonPeriodKind;
}

export type CreateAcademicUnitInput = Pick<AcademicUnitDto, 'code' | 'name' | 'type'> & Partial<Pick<AcademicUnitDto, 'parentId' | 'status'>>;
export type UpdateAcademicUnitInput = Partial<Pick<AcademicUnitDto, 'name' | 'type' | 'parentId' | 'status'>>;
export type CreateTeacherInput = Pick<TeacherDto, 'code' | 'name'> & Partial<Pick<TeacherDto, 'personnelNumber' | 'email' | 'phone' | 'academicUnitId' | 'membershipId' | 'status'>>;
export type UpdateTeacherInput = Partial<Pick<TeacherDto, 'personnelNumber' | 'name' | 'email' | 'phone' | 'academicUnitId' | 'membershipId' | 'status'>>;
export type CreateAcademicClassInput = Pick<AcademicClassDto, 'code' | 'name' | 'gradeLevel'> & Partial<Pick<AcademicClassDto, 'academicUnitId' | 'homeroomTeacherId' | 'studentCount' | 'status'>>;
export type UpdateAcademicClassInput = Partial<Pick<AcademicClassDto, 'name' | 'gradeLevel' | 'academicUnitId' | 'homeroomTeacherId' | 'studentCount' | 'status'>>;
export type CreateSubjectInput = Pick<SubjectDto, 'code' | 'name'> & Partial<Pick<SubjectDto, 'groupName' | 'academicUnitId' | 'status'>>;
export type UpdateSubjectInput = Partial<Pick<SubjectDto, 'name' | 'groupName' | 'academicUnitId' | 'status'>>;
export type CreateAcademicYearInput = Pick<AcademicYearDto, 'code' | 'name' | 'startsOn' | 'endsOn'> & Partial<Pick<AcademicYearDto, 'status'>>;
export type UpdateAcademicYearInput = Partial<Pick<AcademicYearDto, 'name' | 'startsOn' | 'endsOn' | 'status'>>;
export type CreateSemesterInput = Pick<SemesterDto, 'academicYearId' | 'code' | 'name' | 'startsOn' | 'endsOn'> & Partial<Pick<SemesterDto, 'status'>>;
export type UpdateSemesterInput = Partial<Pick<SemesterDto, 'name' | 'startsOn' | 'endsOn' | 'status'>>;
export type CreateLessonPeriodSetInput = Pick<LessonPeriodSetDto, 'academicYearId' | 'code' | 'name'> & Partial<Pick<LessonPeriodSetDto, 'status'>>;
export type UpdateLessonPeriodSetInput = Partial<Pick<LessonPeriodSetDto, 'name' | 'status'>>;
export type CreateLessonPeriodInput = Pick<LessonPeriodDto, 'lessonPeriodSetId' | 'code' | 'sequence' | 'startsAt' | 'endsAt' | 'kind'> & Partial<Pick<LessonPeriodDto, 'status'>>;
export type UpdateLessonPeriodInput = Partial<Pick<LessonPeriodDto, 'sequence' | 'startsAt' | 'endsAt' | 'kind' | 'status'>>;

export class AcademicMasterContractError extends Error {
  constructor(message = 'Respons Master Data akademik tidak sesuai kontrak API.') {
    super(message);
    this.name = 'AcademicMasterContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(record: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new AcademicMasterContractError();
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') throw new AcademicMasterContractError();
  return value;
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new AcademicMasterContractError();
  return value;
}

function positiveInt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new AcademicMasterContractError();
  return value as number;
}

function nonNegativeInt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new AcademicMasterContractError();
  return value as number;
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new AcademicMasterContractError();
  return value as T[number];
}

function dateTime(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new AcademicMasterContractError();
  return value;
}

function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AcademicMasterContractError();
  return value;
}

function timeOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)) throw new AcademicMasterContractError();
  return value;
}

function base(record: Record<string, unknown>): BaseDto {
  return {
    id: stringValue(record, 'id'),
    schoolId: stringValue(record, 'schoolId'),
    code: stringValue(record, 'code'),
    status: enumValue(record.status, ACADEMIC_MASTER_STATUSES),
    version: positiveInt(record.version),
    createdAt: dateTime(record.createdAt),
    updatedAt: dateTime(record.updatedAt),
  };
}

const BASE_KEYS = ['id', 'schoolId', 'code', 'status', 'version', 'createdAt', 'updatedAt'] as const;

export function parseAcademicUnit(value: unknown): AcademicUnitDto {
  if (!isRecord(value)) throw new AcademicMasterContractError();
  exact(value, [...BASE_KEYS, 'name', 'type', 'parentId']);
  return { ...base(value), name: stringValue(value, 'name'), type: enumValue(value.type, ACADEMIC_UNIT_TYPES), parentId: nullableString(value, 'parentId') };
}

export function parseTeacher(value: unknown): TeacherDto {
  if (!isRecord(value)) throw new AcademicMasterContractError();
  exact(value, [...BASE_KEYS, 'personnelNumber', 'name', 'email', 'phone', 'academicUnitId', 'membershipId']);
  return {
    ...base(value),
    personnelNumber: nullableString(value, 'personnelNumber'),
    name: stringValue(value, 'name'),
    email: nullableString(value, 'email'),
    phone: nullableString(value, 'phone'),
    academicUnitId: nullableString(value, 'academicUnitId'),
    membershipId: nullableString(value, 'membershipId'),
  };
}

export function parseAcademicClass(value: unknown): AcademicClassDto {
  if (!isRecord(value)) throw new AcademicMasterContractError();
  exact(value, [...BASE_KEYS, 'name', 'gradeLevel', 'academicUnitId', 'homeroomTeacherId', 'studentCount']);
  return {
    ...base(value),
    name: stringValue(value, 'name'),
    gradeLevel: positiveInt(value.gradeLevel),
    academicUnitId: nullableString(value, 'academicUnitId'),
    homeroomTeacherId: nullableString(value, 'homeroomTeacherId'),
    studentCount: nonNegativeInt(value.studentCount),
  };
}

export function parseSubject(value: unknown): SubjectDto {
  if (!isRecord(value)) throw new AcademicMasterContractError();
  exact(value, [...BASE_KEYS, 'name', 'groupName', 'academicUnitId']);
  return { ...base(value), name: stringValue(value, 'name'), groupName: nullableString(value, 'groupName'), academicUnitId: nullableString(value, 'academicUnitId') };
}

export function parseAcademicYear(value: unknown): AcademicYearDto {
  if (!isRecord(value)) throw new AcademicMasterContractError();
  exact(value, [...BASE_KEYS, 'name', 'startsOn', 'endsOn']);
  return { ...base(value), name: stringValue(value, 'name'), startsOn: dateOnly(value.startsOn), endsOn: dateOnly(value.endsOn) };
}

export function parseSemester(value: unknown): SemesterDto {
  if (!isRecord(value)) throw new AcademicMasterContractError();
  exact(value, [...BASE_KEYS, 'academicYearId', 'name', 'startsOn', 'endsOn']);
  return { ...base(value), academicYearId: stringValue(value, 'academicYearId'), name: stringValue(value, 'name'), startsOn: dateOnly(value.startsOn), endsOn: dateOnly(value.endsOn) };
}

export function parseLessonPeriodSet(value: unknown): LessonPeriodSetDto {
  if (!isRecord(value)) throw new AcademicMasterContractError();
  exact(value, [...BASE_KEYS, 'academicYearId', 'name']);
  return { ...base(value), academicYearId: stringValue(value, 'academicYearId'), name: stringValue(value, 'name') };
}

export function parseLessonPeriod(value: unknown): LessonPeriodDto {
  if (!isRecord(value)) throw new AcademicMasterContractError();
  exact(value, [...BASE_KEYS, 'lessonPeriodSetId', 'sequence', 'startsAt', 'endsAt', 'kind']);
  return {
    ...base(value),
    lessonPeriodSetId: stringValue(value, 'lessonPeriodSetId'),
    sequence: positiveInt(value.sequence),
    startsAt: timeOnly(value.startsAt),
    endsAt: timeOnly(value.endsAt),
    kind: enumValue(value.kind, LESSON_PERIOD_KINDS),
  };
}

function parsePage<T>(value: unknown, parser: (item: unknown) => T): AcademicMasterPage<T> {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.meta)) throw new AcademicMasterContractError();
  exact(value, ['data', 'meta']);
  exact(value.meta, ['page', 'perPage', 'total', 'lastPage']);
  return {
    data: value.data.map(parser),
    meta: {
      page: positiveInt(value.meta.page),
      perPage: positiveInt(value.meta.perPage),
      total: nonNegativeInt(value.meta.total),
      lastPage: positiveInt(value.meta.lastPage),
    },
  };
}

function parseOne<T>(value: unknown, parser: (item: unknown) => T): T {
  if (!isRecord(value)) throw new AcademicMasterContractError();
  exact(value, ['data']);
  return parser(value.data);
}

function query(path: string, filters: ListFilters = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    if (value === null) params.set(key, '');
    else if (typeof value === 'string' && key === 'search') {
      if (value.trim()) params.set(key, value.trim());
    } else params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function itemPath(path: string, id: string): string {
  const normalized = id.trim();
  if (!normalized) throw new AcademicMasterContractError('ID Master Data tidak valid.');
  return `${path}/${encodeURIComponent(normalized)}`;
}

function ifMatch(version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new AcademicMasterContractError('Versi Master Data tidak valid.');
  return { ifMatch: `"${version}"` };
}

export function createAcademicMasterGateway(client: ApiClient) {
  const resource = <T, C extends object, U extends object>(path: string, parser: (value: unknown) => T) => ({
    list: async (filters: ListFilters = {}) => parsePage(await client.get<unknown>(query(path, filters)), parser),
    show: async (id: string) => parseOne(await client.get<unknown>(itemPath(path, id)), parser),
    create: async (input: C) => parseOne(await client.post<unknown>(path, input), parser),
    update: async (id: string, version: number, input: U) => {
      if (Object.keys(input).length === 0) throw new AcademicMasterContractError('Tidak ada perubahan Master Data yang dikirim.');
      return parseOne(await client.patch<unknown>(itemPath(path, id), input, ifMatch(version)), parser);
    },
  });

  return {
    academicUnits: resource<AcademicUnitDto, CreateAcademicUnitInput, UpdateAcademicUnitInput>('/master-data/academic-units', parseAcademicUnit),
    teachers: resource<TeacherDto, CreateTeacherInput, UpdateTeacherInput>('/master-data/teachers', parseTeacher),
    classes: resource<AcademicClassDto, CreateAcademicClassInput, UpdateAcademicClassInput>('/master-data/classes', parseAcademicClass),
    subjects: resource<SubjectDto, CreateSubjectInput, UpdateSubjectInput>('/master-data/subjects', parseSubject),
    academicYears: resource<AcademicYearDto, CreateAcademicYearInput, UpdateAcademicYearInput>('/master-data/academic-years', parseAcademicYear),
    semesters: resource<SemesterDto, CreateSemesterInput, UpdateSemesterInput>('/master-data/semesters', parseSemester),
    lessonPeriodSets: resource<LessonPeriodSetDto, CreateLessonPeriodSetInput, UpdateLessonPeriodSetInput>('/master-data/lesson-period-sets', parseLessonPeriodSet),
    lessonPeriods: resource<LessonPeriodDto, CreateLessonPeriodInput, UpdateLessonPeriodInput>('/master-data/lesson-periods', parseLessonPeriod),
  };
}

export const academicMasterGateway = createAcademicMasterGateway(apiClient);
export type AcademicMasterGateway = ReturnType<typeof createAcademicMasterGateway>;
