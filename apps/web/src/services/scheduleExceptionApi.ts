import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export type ScheduleExceptionResolution = 'cancel' | 'relocate';
export type ScheduleExceptionStatus = 'active' | 'cancelled';

export interface ScheduleExceptionLaboratoryDto {
  id: string;
  code: string;
  name: string;
  capacity: number;
  status: 'active' | 'inactive';
}

export interface ScheduleExceptionReferenceDto {
  id: string;
  code: string;
  name: string;
}

export interface ScheduleExceptionSourceOccurrenceDto {
  id: string;
  date: string;
  startsAt: string;
  endsAt: string;
  activityType: 'practical' | 'theory' | 'exam' | 'other';
  teacher: ScheduleExceptionReferenceDto;
  academicClass: ScheduleExceptionReferenceDto;
  subject: ScheduleExceptionReferenceDto;
}

export interface ScheduleExceptionTimelineDto {
  eventType: 'schedule_exception.applied' | 'schedule_exception.cancelled';
  actorName: string;
  at: string;
  payload: Record<string, unknown>;
  versionBefore: number;
  versionAfter: number;
}

export interface ScheduleExceptionDto {
  id: string;
  schoolId: string;
  occurrenceId: string;
  publicationId: string;
  sourcePublicationId: string;
  sourceVersion: number;
  sourceScheduleId: string;
  occursOn: string;
  resolution: ScheduleExceptionResolution;
  status: ScheduleExceptionStatus;
  originalLaboratory: ScheduleExceptionLaboratoryDto | null;
  replacementLaboratory: ScheduleExceptionLaboratoryDto | null;
  reason: string;
  approvedBy: { userId: string; membershipId: string; name: string };
  version: number;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceOccurrence: ScheduleExceptionSourceOccurrenceDto;
  timeline: ScheduleExceptionTimelineDto[];
}

export interface CreateScheduleExceptionInput {
  occurrenceId: string;
  resolution: ScheduleExceptionResolution;
  replacementLaboratoryId?: string | null;
  reason: string;
}

export interface ScheduleExceptionGateway {
  create: (input: CreateScheduleExceptionInput) => Promise<ScheduleExceptionDto>;
  cancel: (id: string, version: number, reason: string) => Promise<ScheduleExceptionDto>;
  show: (id: string) => Promise<ScheduleExceptionDto>;
}

export class ScheduleExceptionContractError extends Error {
  constructor(message = 'Respons Schedule Exception tidak sesuai kontrak API.') {
    super(message);
    this.name = 'ScheduleExceptionContractError';
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const ACTIVITY = ['practical', 'theory', 'exam', 'other'] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(value: unknown): value is string {
  return typeof value === 'string';
}

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonnegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function datetime(value: unknown): value is string {
  return string(value) && !Number.isNaN(Date.parse(value));
}

function parseReference(value: unknown): ScheduleExceptionReferenceDto {
  if (!record(value) || !string(value.id) || !isUlid(value.id) || !string(value.code) || !string(value.name)) {
    throw new ScheduleExceptionContractError();
  }
  return { id: value.id, code: value.code, name: value.name };
}

function parseLaboratory(value: unknown): ScheduleExceptionLaboratoryDto | null {
  if (value === null) return null;
  if (!record(value)
    || !string(value.id)
    || !isUlid(value.id)
    || !string(value.code)
    || !string(value.name)
    || !positive(value.capacity)
    || !['active', 'inactive'].includes(String(value.status))) {
    throw new ScheduleExceptionContractError();
  }
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    capacity: value.capacity,
    status: value.status as 'active' | 'inactive',
  };
}

function parseSourceOccurrence(value: unknown): ScheduleExceptionSourceOccurrenceDto {
  if (!record(value)
    || !string(value.id)
    || !isUlid(value.id)
    || !string(value.date)
    || !DATE.test(value.date)
    || !string(value.startsAt)
    || !TIME.test(value.startsAt)
    || !string(value.endsAt)
    || !TIME.test(value.endsAt)
    || value.startsAt >= value.endsAt
    || !ACTIVITY.includes(value.activityType as (typeof ACTIVITY)[number])) {
    throw new ScheduleExceptionContractError();
  }

  return {
    id: value.id,
    date: value.date,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    activityType: value.activityType as ScheduleExceptionSourceOccurrenceDto['activityType'],
    teacher: parseReference(value.teacher),
    academicClass: parseReference(value.academicClass),
    subject: parseReference(value.subject),
  };
}

function parseTimeline(value: unknown): ScheduleExceptionTimelineDto {
  if (!record(value)
    || !['schedule_exception.applied', 'schedule_exception.cancelled'].includes(String(value.eventType))
    || !string(value.actorName)
    || !datetime(value.at)
    || !record(value.payload)
    || !nonnegative(value.versionBefore)
    || !positive(value.versionAfter)) {
    throw new ScheduleExceptionContractError();
  }

  return {
    eventType: value.eventType as ScheduleExceptionTimelineDto['eventType'],
    actorName: value.actorName,
    at: value.at,
    payload: value.payload,
    versionBefore: value.versionBefore,
    versionAfter: value.versionAfter,
  };
}

export function parseScheduleException(value: unknown): ScheduleExceptionDto {
  if (!record(value)
    || !string(value.id)
    || !isUlid(value.id)
    || !string(value.schoolId)
    || !isUlid(value.schoolId)
    || !string(value.occurrenceId)
    || !isUlid(value.occurrenceId)
    || !string(value.publicationId)
    || !isUlid(value.publicationId)
    || !string(value.sourcePublicationId)
    || !positive(value.sourceVersion)
    || !string(value.sourceScheduleId)
    || !string(value.occursOn)
    || !DATE.test(value.occursOn)
    || !['cancel', 'relocate'].includes(String(value.resolution))
    || !['active', 'cancelled'].includes(String(value.status))
    || !string(value.reason)
    || value.reason.trim() === ''
    || !positive(value.version)
    || !datetime(value.createdAt)
    || !datetime(value.updatedAt)
    || !record(value.approvedBy)
    || !string(value.approvedBy.userId)
    || !isUlid(value.approvedBy.userId)
    || !string(value.approvedBy.membershipId)
    || !isUlid(value.approvedBy.membershipId)
    || !string(value.approvedBy.name)
    || !Array.isArray(value.timeline)) {
    throw new ScheduleExceptionContractError();
  }

  if (value.cancelledAt !== null && !datetime(value.cancelledAt)) throw new ScheduleExceptionContractError();

  const originalLaboratory = parseLaboratory(value.originalLaboratory);
  const replacementLaboratory = parseLaboratory(value.replacementLaboratory);
  if (value.resolution === 'cancel' && replacementLaboratory !== null) throw new ScheduleExceptionContractError();
  if (value.resolution === 'relocate' && replacementLaboratory === null) throw new ScheduleExceptionContractError();

  return {
    id: value.id,
    schoolId: value.schoolId,
    occurrenceId: value.occurrenceId,
    publicationId: value.publicationId,
    sourcePublicationId: value.sourcePublicationId,
    sourceVersion: value.sourceVersion,
    sourceScheduleId: value.sourceScheduleId,
    occursOn: value.occursOn,
    resolution: value.resolution as ScheduleExceptionResolution,
    status: value.status as ScheduleExceptionStatus,
    originalLaboratory,
    replacementLaboratory,
    reason: value.reason,
    approvedBy: {
      userId: value.approvedBy.userId,
      membershipId: value.approvedBy.membershipId,
      name: value.approvedBy.name,
    },
    version: value.version,
    cancelledAt: value.cancelledAt as string | null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    sourceOccurrence: parseSourceOccurrence(value.sourceOccurrence),
    timeline: value.timeline.map(parseTimeline),
  };
}

function parseEnvelope(value: unknown): ScheduleExceptionDto {
  if (!record(value) || !('data' in value)) throw new ScheduleExceptionContractError('Envelope Schedule Exception tidak valid.');
  return parseScheduleException(value.data);
}

function exceptionId(id: string): string {
  if (!isUlid(id)) throw new ScheduleExceptionContractError('ID Schedule Exception tidak valid.');
  return encodeURIComponent(id);
}

export function createScheduleExceptionGateway(client: ApiClient): ScheduleExceptionGateway {
  return {
    async create(input) {
      if (!isUlid(input.occurrenceId) || input.reason.trim() === '') throw new ScheduleExceptionContractError('Data Schedule Exception tidak valid.');
      if (input.resolution === 'relocate' && (!input.replacementLaboratoryId || !isUlid(input.replacementLaboratoryId))) {
        throw new ScheduleExceptionContractError('Laboratorium pengganti tidak valid.');
      }
      if (input.resolution === 'cancel' && input.replacementLaboratoryId != null) {
        throw new ScheduleExceptionContractError('Pembatalan occurrence tidak memakai Laboratorium pengganti.');
      }

      return parseEnvelope(await client.post<unknown>('/schedule-exceptions', {
        occurrenceId: input.occurrenceId,
        resolution: input.resolution,
        ...(input.resolution === 'relocate' ? { replacementLaboratoryId: input.replacementLaboratoryId } : {}),
        reason: input.reason.trim(),
      }));
    },

    async cancel(id, version, reason) {
      if (!positive(version) || reason.trim() === '') throw new ScheduleExceptionContractError('Data pembatalan exception tidak valid.');
      return parseEnvelope(await client.post<unknown>(
        `/schedule-exceptions/${exceptionId(id)}/cancel`,
        { reason: reason.trim() },
        { ifMatch: `"${version}"` },
      ));
    },

    async show(id) {
      return parseEnvelope(await client.get<unknown>(`/schedule-exceptions/${exceptionId(id)}`));
    },
  };
}

export const scheduleExceptionGateway = createScheduleExceptionGateway(apiClient);
