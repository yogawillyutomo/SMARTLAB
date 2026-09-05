import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_PRIORITIES,
  INCIDENT_STATUSES,
  type IncidentCategory,
  type IncidentPriority,
  type IncidentStatus,
} from '@/services/incidentApi';

export const SESSION_OBSERVATION_SUBJECT_TYPES = ['device', 'asset', 'facility', 'other'] as const;
export const SESSION_OBSERVATION_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export type SessionObservationSubjectType = (typeof SESSION_OBSERVATION_SUBJECT_TYPES)[number];
export type SessionObservationSeverity = (typeof SESSION_OBSERVATION_SEVERITIES)[number];

export interface SessionIssueObservationDto {
  id: string;
  sessionId: string;
  subjectType: SessionObservationSubjectType;
  referenceId: string | null;
  referenceCode: string | null;
  summary: string;
  severity: SessionObservationSeverity;
  observedAt: string;
  observedBy: { userId: string; membershipId: string; name: string };
  incident: { id: string; ticketNumber: string; status: IncidentStatus } | null;
  incidentLinkedAt: string | null;
  version: number;
  createdAt: string;
}

export interface CreateSessionIssueObservationInput {
  subjectType: SessionObservationSubjectType;
  referenceId?: string | null;
  summary: string;
  severity: SessionObservationSeverity;
  observedAt: string;
}

export interface PromoteSessionIssueObservationInput {
  category: IncidentCategory;
  priority: IncidentPriority;
  title: string;
  description: string;
  impact?: string | null;
  blocksLaboratoryOperation: boolean;
  stepsTaken?: string | null;
}

export interface SessionObservationGateway {
  list: (sessionId: string) => Promise<SessionIssueObservationDto[]>;
  create: (sessionId: string, input: CreateSessionIssueObservationInput) => Promise<SessionIssueObservationDto>;
  promote: (observationId: string, input: PromoteSessionIssueObservationInput) => Promise<SessionIssueObservationDto>;
}

export class SessionObservationContractError extends Error {
  constructor(message = 'Respons Temuan Pelaksanaan tidak sesuai kontrak API.') {
    super(message);
    this.name = 'SessionObservationContractError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function string(value: unknown): value is string { return typeof value === 'string'; }
function datetime(value: unknown): value is string { return string(value) && !Number.isNaN(Date.parse(value)); }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function enumValue<T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (!string(value) || !(values as readonly string[]).includes(value)) throw new SessionObservationContractError();
  return value as T[number];
}
function id(value: unknown, label: string): string {
  if (!string(value) || !isUlid(value)) throw new SessionObservationContractError(`${label} tidak valid.`);
  return value;
}

export function parseSessionIssueObservation(value: unknown): SessionIssueObservationDto {
  if (!record(value)
    || !string(value.summary)
    || !datetime(value.observedAt)
    || !record(value.observedBy)
    || !string(value.observedBy.userId) || value.observedBy.userId.trim() === ''
    || !string(value.observedBy.membershipId) || value.observedBy.membershipId.trim() === ''
    || !string(value.observedBy.name)
    || !(value.incidentLinkedAt === null || datetime(value.incidentLinkedAt))
    || !positive(value.version)
    || !datetime(value.createdAt)) {
    throw new SessionObservationContractError();
  }

  const subjectType = enumValue(value.subjectType, SESSION_OBSERVATION_SUBJECT_TYPES);
  const referenceId = value.referenceId === null ? null : id(value.referenceId, 'Reference ID');
  if (!(value.referenceCode === null || string(value.referenceCode))) throw new SessionObservationContractError();
  if (subjectType === 'device' && referenceId === null) throw new SessionObservationContractError();
  if (subjectType !== 'device' && referenceId !== null) throw new SessionObservationContractError();

  let incident: SessionIssueObservationDto['incident'] = null;
  if (value.incident !== null) {
    if (!record(value.incident) || !string(value.incident.ticketNumber)) throw new SessionObservationContractError();
    incident = {
      id: id(value.incident.id, 'Incident ID'),
      ticketNumber: value.incident.ticketNumber,
      status: enumValue(value.incident.status, INCIDENT_STATUSES),
    };
  }

  return {
    id: id(value.id, 'Observation ID'),
    sessionId: id(value.sessionId, 'Session ID'),
    subjectType,
    referenceId,
    referenceCode: value.referenceCode as string | null,
    summary: value.summary,
    severity: enumValue(value.severity, SESSION_OBSERVATION_SEVERITIES),
    observedAt: value.observedAt,
    observedBy: {
      userId: value.observedBy.userId,
      membershipId: value.observedBy.membershipId,
      name: value.observedBy.name,
    },
    incident,
    incidentLinkedAt: value.incidentLinkedAt as string | null,
    version: value.version,
    createdAt: value.createdAt,
  };
}

function pathId(value: string, label: string): string {
  if (!isUlid(value)) throw new SessionObservationContractError(`${label} tidak valid.`);
  return encodeURIComponent(value);
}

function envelope(value: unknown): SessionIssueObservationDto {
  if (!record(value) || !('data' in value)) throw new SessionObservationContractError();
  return parseSessionIssueObservation(value.data);
}

export function createSessionObservationGateway(client: ApiClient): SessionObservationGateway {
  return {
    async list(sessionId) {
      const value = await client.get<unknown>(`/laboratory-sessions/${pathId(sessionId, 'Session ID')}/observations`);
      if (!record(value) || !Array.isArray(value.data)) throw new SessionObservationContractError();
      return value.data.map(parseSessionIssueObservation);
    },
    async create(sessionId, input) {
      return envelope(await client.post<unknown>(
        `/laboratory-sessions/${pathId(sessionId, 'Session ID')}/observations`,
        {
          subjectType: enumValue(input.subjectType, SESSION_OBSERVATION_SUBJECT_TYPES),
          referenceId: input.referenceId ?? null,
          summary: input.summary.trim(),
          severity: enumValue(input.severity, SESSION_OBSERVATION_SEVERITIES),
          observedAt: input.observedAt,
        },
      ));
    },
    async promote(observationId, input) {
      if (!INCIDENT_CATEGORIES.includes(input.category) || !INCIDENT_PRIORITIES.includes(input.priority)) {
        throw new SessionObservationContractError('Kategori atau prioritas Incident tidak valid.');
      }
      return envelope(await client.post<unknown>(
        `/session-observations/${pathId(observationId, 'Observation ID')}/promote-incident`,
        {
          category: input.category,
          priority: input.priority,
          title: input.title.trim(),
          description: input.description.trim(),
          impact: input.impact?.trim() || null,
          blocksLaboratoryOperation: input.blocksLaboratoryOperation,
          stepsTaken: input.stepsTaken?.trim() || null,
        },
      ));
    },
  };
}

export const sessionObservationGateway = createSessionObservationGateway(apiClient);
