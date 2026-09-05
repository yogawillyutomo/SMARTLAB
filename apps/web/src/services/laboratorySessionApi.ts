import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export type LaboratorySessionSourceType = 'schedule_occurrence' | 'laboratory_reservation' | 'priority_event';
export type LaboratorySessionStatus = 'prepared' | 'in_progress' | 'ended' | 'cancelled';
export type LaboratorySessionActivityKind = 'practical' | 'theory' | 'exam' | 'other';

export interface SessionLaboratoryDto {
  id: string;
  code: string;
  name: string;
  capacity: number;
  status: 'active' | 'inactive';
}

export interface SessionReferenceDto {
  id: string;
  code: string;
  name: string;
}

export interface LaboratorySessionReportSummaryDto {
  id: string;
  reportNumber: string;
  reportType: 'practicum' | 'exam' | 'workshop' | 'general';
  status: 'draft' | 'submitted' | 'revision_required' | 'verified';
  version: number;
}

export interface LaboratorySessionTimelineDto {
  eventType: string;
  actorName: string;
  at: string;
  payload: Record<string, unknown>;
  versionBefore: number;
  versionAfter: number;
}

export interface LaboratorySessionDto {
  id: string;
  schoolId: string;
  sessionNumber: string;
  source: {
    type: LaboratorySessionSourceType;
    id: string;
    versionEvidence: number;
    fingerprint: string;
    publicationId: string | null;
    evidence: Record<string, unknown>;
    ownerMembershipId: string | null;
    date: string;
    startsAt: string;
    endsAt: string;
  };
  laboratory: SessionLaboratoryDto;
  activityKind: LaboratorySessionActivityKind;
  responsibility: {
    teacherId: string | null;
    name: string;
    teacherCode: string | null;
    academicClass: (SessionReferenceDto & { studentCount: number }) | null;
    subject: SessionReferenceDto | null;
    plannedParticipantCount: number | null;
  };
  status: LaboratorySessionStatus;
  openingCondition: string | null;
  closingCondition: string | null;
  endOutcome: 'completed' | 'interrupted' | null;
  operationalNotes: string | null;
  actualStartedAt: string | null;
  actualEndedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  activityReport: LaboratorySessionReportSummaryDto | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  timeline: LaboratorySessionTimelineDto[];
}

export interface LaboratorySessionSourceDto {
  sourceType: LaboratorySessionSourceType;
  sourceId: string;
  sourceNumber: string;
  date: string;
  startsAt: string;
  endsAt: string;
  activityKind: LaboratorySessionActivityKind;
  title: string;
  subtitle: string;
  laboratory: SessionLaboratoryDto;
  responsibility: {
    name: string;
    teacherId: string | null;
    academicClass: SessionReferenceDto | null;
    subject: SessionReferenceDto | null;
    plannedParticipantCount: number;
  };
  session: {
    id: string;
    sessionNumber: string;
    status: LaboratorySessionStatus;
    version: number;
    actualStartedAt: string | null;
    actualEndedAt: string | null;
    activityReport: LaboratorySessionReportSummaryDto | null;
  } | null;
}

export interface LaboratorySessionFilters {
  from: string;
  to: string;
  laboratoryId?: string;
  sourceType?: LaboratorySessionSourceType;
  status?: LaboratorySessionStatus;
  scope?: 'mine' | 'all';
  page?: number;
  perPage?: number;
}

export interface LaboratorySessionPage {
  data: LaboratorySessionDto[];
  meta: { page: number; perPage: number; total: number; lastPage: number; from: string; to: string };
}

export interface SessionSourceFilters {
  from: string;
  to: string;
  laboratoryId?: string;
  scope?: 'mine' | 'all';
}

export interface PrepareLaboratorySessionInput {
  sourceType: LaboratorySessionSourceType;
  sourceId: string;
  openingCondition?: string | null;
  operationalNotes?: string | null;
}

export interface EndLaboratorySessionInput {
  endOutcome: 'completed' | 'interrupted';
  closingCondition?: string | null;
  operationalNotes?: string | null;
}

export interface LaboratorySessionGateway {
  list: (filters: LaboratorySessionFilters) => Promise<LaboratorySessionPage>;
  listAll: (filters: Omit<LaboratorySessionFilters, 'page' | 'perPage'>) => Promise<LaboratorySessionDto[]>;
  sources: (filters: SessionSourceFilters) => Promise<LaboratorySessionSourceDto[]>;
  show: (id: string) => Promise<LaboratorySessionDto>;
  prepare: (input: PrepareLaboratorySessionInput) => Promise<LaboratorySessionDto>;
  start: (id: string, version: number) => Promise<LaboratorySessionDto>;
  end: (id: string, version: number, input: EndLaboratorySessionInput) => Promise<LaboratorySessionDto>;
  cancel: (id: string, version: number, reason: string) => Promise<LaboratorySessionDto>;
}

export class LaboratorySessionContractError extends Error {
  constructor(message = 'Respons Pelaksanaan Lab tidak sesuai kontrak API.') {
    super(message);
    this.name = 'LaboratorySessionContractError';
  }
}

const SOURCE_TYPES: LaboratorySessionSourceType[] = ['schedule_occurrence', 'laboratory_reservation', 'priority_event'];
const STATUSES: LaboratorySessionStatus[] = ['prepared', 'in_progress', 'ended', 'cancelled'];
const ACTIVITY_KINDS: LaboratorySessionActivityKind[] = ['practical', 'theory', 'exam', 'other'];
const REPORT_TYPES = ['practicum', 'exam', 'workshop', 'general'] as const;
const REPORT_STATUSES = ['draft', 'submitted', 'revision_required', 'verified'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function string(value: unknown): value is string { return typeof value === 'string'; }
function nonnegative(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function nullableString(value: unknown): value is string | null { return value === null || string(value); }
function datetime(value: unknown): value is string { return string(value) && !Number.isNaN(Date.parse(value)); }
function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function parseLab(value: unknown): SessionLaboratoryDto {
  if (!record(value) || !string(value.id) || !isUlid(value.id) || !string(value.code) || !string(value.name)
    || !positive(value.capacity) || !['active', 'inactive'].includes(String(value.status))) {
    throw new LaboratorySessionContractError();
  }
  return { id: value.id, code: value.code, name: value.name, capacity: value.capacity, status: value.status as 'active' | 'inactive' };
}

function parseReference(value: unknown): SessionReferenceDto {
  if (!record(value) || !string(value.id) || !isUlid(value.id) || !string(value.code) || !string(value.name)) {
    throw new LaboratorySessionContractError();
  }
  return { id: value.id, code: value.code, name: value.name };
}

function parseReportSummary(value: unknown): LaboratorySessionReportSummaryDto {
  if (!record(value) || !string(value.id) || !isUlid(value.id) || !string(value.reportNumber)
    || !REPORT_TYPES.includes(value.reportType as typeof REPORT_TYPES[number])
    || !REPORT_STATUSES.includes(value.status as typeof REPORT_STATUSES[number])
    || !positive(value.version)) {
    throw new LaboratorySessionContractError();
  }
  return {
    id: value.id,
    reportNumber: value.reportNumber,
    reportType: value.reportType as LaboratorySessionReportSummaryDto['reportType'],
    status: value.status as LaboratorySessionReportSummaryDto['status'],
    version: value.version,
  };
}

function parseTimeline(value: unknown): LaboratorySessionTimelineDto {
  if (!record(value) || !string(value.eventType) || !string(value.actorName) || !datetime(value.at)
    || !record(value.payload) || !nonnegative(value.versionBefore) || !positive(value.versionAfter)) {
    throw new LaboratorySessionContractError();
  }
  return {
    eventType: value.eventType,
    actorName: value.actorName,
    at: value.at,
    payload: value.payload,
    versionBefore: value.versionBefore,
    versionAfter: value.versionAfter,
  };
}

export function parseLaboratorySession(value: unknown): LaboratorySessionDto {
  if (!record(value) || !string(value.id) || !isUlid(value.id) || !string(value.schoolId) || !isUlid(value.schoolId)
    || !string(value.sessionNumber) || !record(value.source) || !record(value.responsibility)
    || !STATUSES.includes(value.status as LaboratorySessionStatus)
    || !ACTIVITY_KINDS.includes(value.activityKind as LaboratorySessionActivityKind)
    || !nullableString(value.openingCondition) || !nullableString(value.closingCondition)
    || !nullableString(value.operationalNotes) || !nullableString(value.cancellationReason)
    || !positive(value.version) || !datetime(value.createdAt) || !datetime(value.updatedAt)
    || !Array.isArray(value.timeline)) {
    throw new LaboratorySessionContractError();
  }

  const source = value.source;
  if (!SOURCE_TYPES.includes(source.type as LaboratorySessionSourceType)
    || !string(source.id) || !isUlid(source.id)
    || !positive(source.versionEvidence)
    || !string(source.fingerprint) || source.fingerprint.length !== 64
    || !(source.publicationId === null || (string(source.publicationId) && isUlid(source.publicationId)))
    || !record(source.evidence)
    || !(source.ownerMembershipId === null || (string(source.ownerMembershipId) && isUlid(source.ownerMembershipId)))
    || !string(source.date) || !validDate(source.date)
    || !string(source.startsAt) || !TIME.test(source.startsAt)
    || !string(source.endsAt) || !TIME.test(source.endsAt)
    || source.startsAt >= source.endsAt) {
    throw new LaboratorySessionContractError();
  }

  const responsibility = value.responsibility;
  const academicClass = responsibility.academicClass;
  const subject = responsibility.subject;
  if (!(responsibility.teacherId === null || (string(responsibility.teacherId) && isUlid(responsibility.teacherId)))
    || !string(responsibility.name)
    || !(responsibility.teacherCode === null || string(responsibility.teacherCode))
    || !(academicClass === null || record(academicClass))
    || !(subject === null || record(subject))
    || !(responsibility.plannedParticipantCount === null || nonnegative(responsibility.plannedParticipantCount))) {
    throw new LaboratorySessionContractError();
  }

  let parsedClass: (SessionReferenceDto & { studentCount: number }) | null = null;
  if (academicClass !== null) {
    const parsed = parseReference(academicClass);
    if (!nonnegative(academicClass.studentCount)) throw new LaboratorySessionContractError();
    parsedClass = { ...parsed, studentCount: academicClass.studentCount };
  }

  if (![null, 'completed', 'interrupted'].includes(value.endOutcome as null | string)
    || !(value.actualStartedAt === null || datetime(value.actualStartedAt))
    || !(value.actualEndedAt === null || datetime(value.actualEndedAt))
    || !(value.cancelledAt === null || datetime(value.cancelledAt))) {
    throw new LaboratorySessionContractError();
  }

  return {
    id: value.id,
    schoolId: value.schoolId,
    sessionNumber: value.sessionNumber,
    source: {
      type: source.type as LaboratorySessionSourceType,
      id: source.id,
      versionEvidence: source.versionEvidence,
      fingerprint: source.fingerprint,
      publicationId: source.publicationId as string | null,
      evidence: source.evidence,
      ownerMembershipId: source.ownerMembershipId as string | null,
      date: source.date,
      startsAt: source.startsAt,
      endsAt: source.endsAt,
    },
    laboratory: parseLab(value.laboratory),
    activityKind: value.activityKind as LaboratorySessionActivityKind,
    responsibility: {
      teacherId: responsibility.teacherId as string | null,
      name: responsibility.name,
      teacherCode: responsibility.teacherCode as string | null,
      academicClass: parsedClass,
      subject: subject === null ? null : parseReference(subject),
      plannedParticipantCount: responsibility.plannedParticipantCount as number | null,
    },
    status: value.status as LaboratorySessionStatus,
    openingCondition: value.openingCondition as string | null,
    closingCondition: value.closingCondition as string | null,
    endOutcome: value.endOutcome as LaboratorySessionDto['endOutcome'],
    operationalNotes: value.operationalNotes as string | null,
    actualStartedAt: value.actualStartedAt as string | null,
    actualEndedAt: value.actualEndedAt as string | null,
    cancelledAt: value.cancelledAt as string | null,
    cancellationReason: value.cancellationReason as string | null,
    activityReport: value.activityReport === null ? null : parseReportSummary(value.activityReport),
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    timeline: value.timeline.map(parseTimeline),
  };
}

function parseSource(value: unknown): LaboratorySessionSourceDto {
  if (!record(value) || !SOURCE_TYPES.includes(value.sourceType as LaboratorySessionSourceType)
    || !string(value.sourceId) || !isUlid(value.sourceId) || !string(value.sourceNumber)
    || !string(value.date) || !validDate(value.date)
    || !string(value.startsAt) || !TIME.test(value.startsAt)
    || !string(value.endsAt) || !TIME.test(value.endsAt) || value.startsAt >= value.endsAt
    || !ACTIVITY_KINDS.includes(value.activityKind as LaboratorySessionActivityKind)
    || !string(value.title) || !string(value.subtitle) || !record(value.responsibility)) {
    throw new LaboratorySessionContractError();
  }

  const responsibility = value.responsibility;
  if (!string(responsibility.name)
    || !(responsibility.teacherId === null || (string(responsibility.teacherId) && isUlid(responsibility.teacherId)))
    || !(responsibility.academicClass === null || record(responsibility.academicClass))
    || !(responsibility.subject === null || record(responsibility.subject))
    || !nonnegative(responsibility.plannedParticipantCount)) {
    throw new LaboratorySessionContractError();
  }

  let session: LaboratorySessionSourceDto['session'] = null;
  if (value.session !== null) {
    if (!record(value.session) || !string(value.session.id) || !isUlid(value.session.id) || !string(value.session.sessionNumber)
      || !STATUSES.includes(value.session.status as LaboratorySessionStatus) || !positive(value.session.version)
      || !(value.session.actualStartedAt === null || datetime(value.session.actualStartedAt))
      || !(value.session.actualEndedAt === null || datetime(value.session.actualEndedAt))) {
      throw new LaboratorySessionContractError();
    }
    session = {
      id: value.session.id,
      sessionNumber: value.session.sessionNumber,
      status: value.session.status as LaboratorySessionStatus,
      version: value.session.version,
      actualStartedAt: value.session.actualStartedAt as string | null,
      actualEndedAt: value.session.actualEndedAt as string | null,
      activityReport: value.session.activityReport === null ? null : parseReportSummary(value.session.activityReport),
    };
  }

  return {
    sourceType: value.sourceType as LaboratorySessionSourceType,
    sourceId: value.sourceId,
    sourceNumber: value.sourceNumber,
    date: value.date,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    activityKind: value.activityKind as LaboratorySessionActivityKind,
    title: value.title,
    subtitle: value.subtitle,
    laboratory: parseLab(value.laboratory),
    responsibility: {
      name: responsibility.name,
      teacherId: responsibility.teacherId as string | null,
      academicClass: responsibility.academicClass === null ? null : parseReference(responsibility.academicClass),
      subject: responsibility.subject === null ? null : parseReference(responsibility.subject),
      plannedParticipantCount: responsibility.plannedParticipantCount,
    },
    session,
  };
}

function parseEnvelope(value: unknown): LaboratorySessionDto {
  if (!record(value) || !('data' in value)) throw new LaboratorySessionContractError();
  return parseLaboratorySession(value.data);
}

function assertRange(from: string, to: string, maxDays: number): void {
  if (!validDate(from) || !validDate(to) || from > to) throw new LaboratorySessionContractError('Rentang Pelaksanaan Lab tidak valid.');
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const days = (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000;
  if (days > maxDays - 1) throw new LaboratorySessionContractError(`Rentang Pelaksanaan Lab maksimal ${maxDays} hari.`);
}

function pathId(id: string): string {
  if (!isUlid(id)) throw new LaboratorySessionContractError('ID Pelaksanaan Lab tidak valid.');
  return encodeURIComponent(id);
}

function listPath(filters: LaboratorySessionFilters): string {
  assertRange(filters.from, filters.to, 366);
  const q = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.laboratoryId) q.set('laboratoryId', filters.laboratoryId);
  if (filters.sourceType) q.set('sourceType', filters.sourceType);
  if (filters.status) q.set('status', filters.status);
  if (filters.scope) q.set('scope', filters.scope);
  if (filters.page !== undefined) q.set('page', String(filters.page));
  if (filters.perPage !== undefined) q.set('perPage', String(filters.perPage));
  return `/laboratory-sessions?${q.toString()}`;
}

function parsePage(value: unknown): LaboratorySessionPage {
  if (!record(value) || !Array.isArray(value.data) || !record(value.meta)) throw new LaboratorySessionContractError();
  const { page, perPage, total, lastPage, from, to } = value.meta;
  if (!positive(page) || !positive(perPage) || !nonnegative(total) || !positive(lastPage)
    || !string(from) || !validDate(from) || !string(to) || !validDate(to)) {
    throw new LaboratorySessionContractError();
  }
  const data = value.data.map(parseLaboratorySession);
  if (data.length > perPage || data.length > total || page > lastPage) throw new LaboratorySessionContractError();
  return { data, meta: { page, perPage, total, lastPage, from, to } };
}

function sourcePath(filters: SessionSourceFilters): string {
  assertRange(filters.from, filters.to, 14);
  const q = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.laboratoryId) q.set('laboratoryId', filters.laboratoryId);
  if (filters.scope) q.set('scope', filters.scope);
  return `/laboratory-session-sources?${q.toString()}`;
}

export function createLaboratorySessionGateway(client: ApiClient): LaboratorySessionGateway {
  const list: LaboratorySessionGateway['list'] = async (filters) => parsePage(await client.get<unknown>(listPath(filters)));
  return {
    list,
    async listAll(filters) {
      const first = await list({ ...filters, page: 1, perPage: 500 });
      if (first.meta.lastPage > 20) throw new LaboratorySessionContractError('Terlalu banyak Pelaksanaan Lab untuk dimuat sekaligus.');
      const pages = [first];
      for (let page = 2; page <= first.meta.lastPage; page += 1) {
        const next = await list({ ...filters, page, perPage: 500 });
        if (next.meta.total !== first.meta.total || next.meta.lastPage !== first.meta.lastPage
          || next.meta.from !== first.meta.from || next.meta.to !== first.meta.to) {
          throw new LaboratorySessionContractError('Pagination Pelaksanaan Lab berubah selama pembacaan.');
        }
        pages.push(next);
      }
      const data = pages.flatMap((page) => page.data);
      if (data.length !== first.meta.total) throw new LaboratorySessionContractError('Koleksi Pelaksanaan Lab tidak lengkap.');
      return data;
    },
    async sources(filters) {
      const value = await client.get<unknown>(sourcePath(filters));
      if (!record(value) || !Array.isArray(value.data)) throw new LaboratorySessionContractError();
      return value.data.map(parseSource);
    },
    async show(id) { return parseEnvelope(await client.get<unknown>(`/laboratory-sessions/${pathId(id)}`)); },
    async prepare(input) { return parseEnvelope(await client.post<unknown>('/laboratory-sessions', input)); },
    async start(id, version) {
      return parseEnvelope(await client.post<unknown>(`/laboratory-sessions/${pathId(id)}/start`, undefined, { ifMatch: `"${version}"` }));
    },
    async end(id, version, input) {
      return parseEnvelope(await client.post<unknown>(`/laboratory-sessions/${pathId(id)}/end`, input, { ifMatch: `"${version}"` }));
    },
    async cancel(id, version, reason) {
      return parseEnvelope(await client.post<unknown>(`/laboratory-sessions/${pathId(id)}/cancel`, { reason: reason.trim() }, { ifMatch: `"${version}"` }));
    },
  };
}

export const laboratorySessionGateway = createLaboratorySessionGateway(apiClient);
