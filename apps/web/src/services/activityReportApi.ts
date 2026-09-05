import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export type ActivityReportType = 'practicum' | 'exam' | 'workshop' | 'general';
export type ActivityReportStatus = 'draft' | 'submitted' | 'revision_required' | 'verified';
export type ActivityReportOrigin = 'session' | 'manual_backfill';

export interface ActivityReportReferenceDto {
  id: string;
  code: string;
  name: string;
}

export interface ActivityReportDto {
  id: string;
  schoolId: string;
  reportNumber: string;
  origin: ActivityReportOrigin;
  sessionId: string | null;
  ownerMembershipId: string | null;
  manualBackfillReason: string | null;
  reportType: ActivityReportType;
  status: ActivityReportStatus;
  laboratory: ActivityReportReferenceDto & { capacity: number; status: 'active' | 'inactive' };
  occurredOn: string;
  sourceSnapshot: Record<string, unknown>;
  sessionSnapshot: Record<string, unknown> | null;
  responsibility: {
    teacherId: string | null;
    name: string;
    teacherCode: string | null;
    academicClass: ActivityReportReferenceDto | null;
    subject: ActivityReportReferenceDto | null;
  };
  attendance: {
    plannedParticipantCount: number | null;
    presentCount: number | null;
    absentCount: number | null;
    notes: string | null;
    externalSystem: string | null;
    externalReferenceId: string | null;
  };
  commonContent: Record<string, string | null>;
  typeSpecificContent: Record<string, string | null>;
  revisionReason: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  timeline: {
    eventType: string;
    actorName: string;
    at: string;
    payload: Record<string, unknown>;
    versionBefore: number;
    versionAfter: number;
  }[];
}

export interface ActivityReportFilters {
  from: string;
  to: string;
  laboratoryId?: string;
  reportType?: ActivityReportType;
  status?: ActivityReportStatus;
  origin?: ActivityReportOrigin;
  scope?: 'mine' | 'all';
  page?: number;
  perPage?: number;
}

export interface ActivityReportPage {
  data: ActivityReportDto[];
  meta: { page: number; perPage: number; total: number; lastPage: number; from: string; to: string };
}

export interface UpdateActivityReportInput {
  reportType?: ActivityReportType;
  presentCount?: number | null;
  absentCount?: number | null;
  attendanceNotes?: string | null;
  externalAttendanceSystem?: string | null;
  externalAttendanceReferenceId?: string | null;
  commonContent?: Record<string, string | null>;
  typeSpecificContent?: Record<string, string | null>;
}

export interface CreateActivityReportBackfillInput extends UpdateActivityReportInput {
  reportType: ActivityReportType;
  laboratoryId: string;
  occurredOn: string;
  manualBackfillReason: string;
  responsibleName: string;
  activityDescription: string;
  plannedParticipantCount?: number | null;
}

export interface ActivityReportGateway {
  list: (filters: ActivityReportFilters) => Promise<ActivityReportPage>;
  listAll: (filters: Omit<ActivityReportFilters, 'page' | 'perPage'>) => Promise<ActivityReportDto[]>;
  show: (id: string) => Promise<ActivityReportDto>;
  update: (id: string, version: number, input: UpdateActivityReportInput) => Promise<ActivityReportDto>;
  submit: (id: string, version: number) => Promise<ActivityReportDto>;
  requestRevision: (id: string, version: number, reason: string) => Promise<ActivityReportDto>;
  reopen: (id: string, version: number) => Promise<ActivityReportDto>;
  verify: (id: string, version: number) => Promise<ActivityReportDto>;
  backfill: (input: CreateActivityReportBackfillInput) => Promise<ActivityReportDto>;
}

export class ActivityReportContractError extends Error {
  constructor(message = 'Respons Laporan Pelaksanaan tidak sesuai kontrak API.') {
    super(message);
    this.name = 'ActivityReportContractError';
  }
}

const TYPES: ActivityReportType[] = ['practicum', 'exam', 'workshop', 'general'];
const STATUSES: ActivityReportStatus[] = ['draft', 'submitted', 'revision_required', 'verified'];
const ORIGINS: ActivityReportOrigin[] = ['session', 'manual_backfill'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function string(value: unknown): value is string { return typeof value === 'string'; }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function nonnegative(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function nullableString(value: unknown): value is string | null { return value === null || string(value); }
function datetime(value: unknown): value is string { return string(value) && !Number.isNaN(Date.parse(value)); }
function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function parseReference(value: unknown): ActivityReportReferenceDto {
  if (!record(value) || !string(value.id) || !isUlid(value.id) || !string(value.code) || !string(value.name)) {
    throw new ActivityReportContractError();
  }
  return { id: value.id, code: value.code, name: value.name };
}

function content(value: unknown): Record<string, string | null> {
  if (!record(value) || !Object.values(value).every(nullableString)) throw new ActivityReportContractError();
  return value as Record<string, string | null>;
}

export function parseActivityReport(value: unknown): ActivityReportDto {
  if (!record(value) || !string(value.id) || !isUlid(value.id) || !string(value.schoolId) || !isUlid(value.schoolId)
    || !string(value.reportNumber) || !ORIGINS.includes(value.origin as ActivityReportOrigin)
    || !(value.sessionId === null || (string(value.sessionId) && isUlid(value.sessionId)))
    || !(value.ownerMembershipId === null || (string(value.ownerMembershipId) && isUlid(value.ownerMembershipId)))
    || !nullableString(value.manualBackfillReason)
    || !TYPES.includes(value.reportType as ActivityReportType)
    || !STATUSES.includes(value.status as ActivityReportStatus)
    || !string(value.occurredOn) || !validDate(value.occurredOn)
    || !record(value.sourceSnapshot) || !(value.sessionSnapshot === null || record(value.sessionSnapshot))
    || !record(value.responsibility) || !record(value.attendance)
    || !nullableString(value.revisionReason)
    || !(value.submittedAt === null || datetime(value.submittedAt))
    || !(value.verifiedAt === null || datetime(value.verifiedAt))
    || !positive(value.version) || !datetime(value.createdAt) || !datetime(value.updatedAt)
    || !Array.isArray(value.timeline)) {
    throw new ActivityReportContractError();
  }

  const laboratory = parseReference(value.laboratory);
  if (!record(value.laboratory) || !positive(value.laboratory.capacity)
    || !['active', 'inactive'].includes(String(value.laboratory.status))) {
    throw new ActivityReportContractError();
  }

  const responsibility = value.responsibility;
  if (!(responsibility.teacherId === null || (string(responsibility.teacherId) && isUlid(responsibility.teacherId)))
    || !string(responsibility.name)
    || !(responsibility.teacherCode === null || string(responsibility.teacherCode))
    || !(responsibility.academicClass === null || record(responsibility.academicClass))
    || !(responsibility.subject === null || record(responsibility.subject))) {
    throw new ActivityReportContractError();
  }

  const attendance = value.attendance;
  for (const key of ['plannedParticipantCount', 'presentCount', 'absentCount'] as const) {
    const count = attendance[key];
    if (!(count === null || nonnegative(count))) throw new ActivityReportContractError();
  }
  if (!nullableString(attendance.notes) || !nullableString(attendance.externalSystem) || !nullableString(attendance.externalReferenceId)) {
    throw new ActivityReportContractError();
  }

  const timeline = value.timeline.map((event) => {
    if (!record(event) || !string(event.eventType) || !string(event.actorName) || !datetime(event.at)
      || !record(event.payload) || !nonnegative(event.versionBefore) || !positive(event.versionAfter)) {
      throw new ActivityReportContractError();
    }
    return {
      eventType: event.eventType,
      actorName: event.actorName,
      at: event.at,
      payload: event.payload,
      versionBefore: event.versionBefore,
      versionAfter: event.versionAfter,
    };
  });

  return {
    id: value.id,
    schoolId: value.schoolId,
    reportNumber: value.reportNumber,
    origin: value.origin as ActivityReportOrigin,
    sessionId: value.sessionId as string | null,
    ownerMembershipId: value.ownerMembershipId as string | null,
    manualBackfillReason: value.manualBackfillReason as string | null,
    reportType: value.reportType as ActivityReportType,
    status: value.status as ActivityReportStatus,
    laboratory: { ...laboratory, capacity: value.laboratory.capacity, status: value.laboratory.status as 'active' | 'inactive' },
    occurredOn: value.occurredOn,
    sourceSnapshot: value.sourceSnapshot,
    sessionSnapshot: value.sessionSnapshot as Record<string, unknown> | null,
    responsibility: {
      teacherId: responsibility.teacherId as string | null,
      name: responsibility.name,
      teacherCode: responsibility.teacherCode as string | null,
      academicClass: responsibility.academicClass === null ? null : parseReference(responsibility.academicClass),
      subject: responsibility.subject === null ? null : parseReference(responsibility.subject),
    },
    attendance: {
      plannedParticipantCount: attendance.plannedParticipantCount as number | null,
      presentCount: attendance.presentCount as number | null,
      absentCount: attendance.absentCount as number | null,
      notes: attendance.notes as string | null,
      externalSystem: attendance.externalSystem as string | null,
      externalReferenceId: attendance.externalReferenceId as string | null,
    },
    commonContent: content(value.commonContent),
    typeSpecificContent: content(value.typeSpecificContent),
    revisionReason: value.revisionReason as string | null,
    submittedAt: value.submittedAt as string | null,
    verifiedAt: value.verifiedAt as string | null,
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    timeline,
  };
}

function parseEnvelope(value: unknown): ActivityReportDto {
  if (!record(value) || !('data' in value)) throw new ActivityReportContractError();
  return parseActivityReport(value.data);
}

function assertRange(from: string, to: string): void {
  if (!validDate(from) || !validDate(to) || from > to) throw new ActivityReportContractError('Rentang Laporan Pelaksanaan tidak valid.');
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if ((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000 > 365) {
    throw new ActivityReportContractError('Rentang Laporan Pelaksanaan maksimal 366 hari.');
  }
}

function pathId(id: string): string {
  if (!isUlid(id)) throw new ActivityReportContractError('ID Laporan Pelaksanaan tidak valid.');
  return encodeURIComponent(id);
}

function listPath(filters: ActivityReportFilters): string {
  assertRange(filters.from, filters.to);
  const q = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.laboratoryId) q.set('laboratoryId', filters.laboratoryId);
  if (filters.reportType) q.set('reportType', filters.reportType);
  if (filters.status) q.set('status', filters.status);
  if (filters.origin) q.set('origin', filters.origin);
  if (filters.scope) q.set('scope', filters.scope);
  if (filters.page !== undefined) q.set('page', String(filters.page));
  if (filters.perPage !== undefined) q.set('perPage', String(filters.perPage));
  return `/activity-reports?${q.toString()}`;
}

function parsePage(value: unknown): ActivityReportPage {
  if (!record(value) || !Array.isArray(value.data) || !record(value.meta)) throw new ActivityReportContractError();
  const { page, perPage, total, lastPage, from, to } = value.meta;
  if (!positive(page) || !positive(perPage) || !nonnegative(total) || !positive(lastPage)
    || !string(from) || !validDate(from) || !string(to) || !validDate(to)) {
    throw new ActivityReportContractError();
  }
  const data = value.data.map(parseActivityReport);
  if (data.length > perPage || data.length > total || page > lastPage) throw new ActivityReportContractError();
  return { data, meta: { page, perPage, total, lastPage, from, to } };
}

export function createActivityReportGateway(client: ApiClient): ActivityReportGateway {
  const list: ActivityReportGateway['list'] = async (filters) => parsePage(await client.get<unknown>(listPath(filters)));
  return {
    list,
    async listAll(filters) {
      const first = await list({ ...filters, page: 1, perPage: 500 });
      if (first.meta.lastPage > 20) throw new ActivityReportContractError('Terlalu banyak laporan untuk dimuat sekaligus.');
      const pages = [first];
      for (let page = 2; page <= first.meta.lastPage; page += 1) {
        const next = await list({ ...filters, page, perPage: 500 });
        if (next.meta.total !== first.meta.total || next.meta.lastPage !== first.meta.lastPage
          || next.meta.from !== first.meta.from || next.meta.to !== first.meta.to) {
          throw new ActivityReportContractError('Pagination Laporan Pelaksanaan berubah selama pembacaan.');
        }
        pages.push(next);
      }
      const data = pages.flatMap((page) => page.data);
      if (data.length !== first.meta.total) throw new ActivityReportContractError('Koleksi Laporan Pelaksanaan tidak lengkap.');
      return data;
    },
    async show(id) { return parseEnvelope(await client.get<unknown>(`/activity-reports/${pathId(id)}`)); },
    async update(id, version, input) {
      return parseEnvelope(await client.patch<unknown>(`/activity-reports/${pathId(id)}`, input, { ifMatch: `"${version}"` }));
    },
    async submit(id, version) {
      return parseEnvelope(await client.post<unknown>(`/activity-reports/${pathId(id)}/submit`, undefined, { ifMatch: `"${version}"` }));
    },
    async requestRevision(id, version, reason) {
      return parseEnvelope(await client.post<unknown>(`/activity-reports/${pathId(id)}/request-revision`, { reason: reason.trim() }, { ifMatch: `"${version}"` }));
    },
    async reopen(id, version) {
      return parseEnvelope(await client.post<unknown>(`/activity-reports/${pathId(id)}/reopen`, undefined, { ifMatch: `"${version}"` }));
    },
    async verify(id, version) {
      return parseEnvelope(await client.post<unknown>(`/activity-reports/${pathId(id)}/verify`, undefined, { ifMatch: `"${version}"` }));
    },
    async backfill(input) {
      return parseEnvelope(await client.post<unknown>('/activity-reports/backfill', input));
    },
  };
}

export const activityReportGateway = createActivityReportGateway(apiClient);
