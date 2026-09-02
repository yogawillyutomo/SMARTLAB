import { apiClient, type ApiClient } from '@/lib/apiClient';

export const INCIDENT_CATEGORIES = ['hardware', 'software', 'network', 'electrical', 'peripheral', 'facility', 'cleanliness', 'security', 'other'] as const;
export const INCIDENT_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export const INCIDENT_STATUSES = ['reported', 'triaged', 'assigned', 'in_progress', 'resolved', 'verified', 'closed', 'rejected'] as const;
export const INCIDENT_EVENT_TYPES = [
  'incident.reported',
  'incident.updated',
  'incident.triaged',
  'incident.assigned',
  'incident.reassigned',
  'incident.started',
  'incident.resolved',
  'incident.reopened',
  'incident.verified',
  'incident.closed',
  'incident.rejected',
  'incident.comment_added',
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];
export type IncidentPriority = (typeof INCIDENT_PRIORITIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type IncidentEventType = (typeof INCIDENT_EVENT_TYPES)[number];

export interface IncidentPaginationMeta {
  page: number;
  perPage: number;
  total: number;
  lastPage: number;
}

export interface IncidentReporterSnapshot {
  userId: string;
  name: string;
}

export interface IncidentLaboratorySnapshot {
  id: string;
  code: string;
  name: string;
}

export interface IncidentDeviceSnapshot {
  id: string;
  deviceCode: string;
  deviceType: string;
}

export interface IncidentAssigneeSnapshot {
  membershipId: string;
  userId: string;
  name: string;
}

export interface IncidentListItem {
  id: string;
  ticketNumber: string;
  reporter: IncidentReporterSnapshot;
  laboratory: IncidentLaboratorySnapshot;
  device: IncidentDeviceSnapshot | null;
  category: IncidentCategory;
  priority: IncidentPriority;
  title: string;
  blocksLaboratoryOperation: boolean;
  status: IncidentStatus;
  assignee: Omit<IncidentAssigneeSnapshot, 'membershipId'> | null;
  version: number;
  occurredAt: string;
  reportedAt: string;
}

export interface IncidentDto {
  id: string;
  ticketNumber: string;
  reporter: IncidentReporterSnapshot;
  laboratory: IncidentLaboratorySnapshot;
  device: IncidentDeviceSnapshot | null;
  category: IncidentCategory;
  priority: IncidentPriority;
  title: string;
  description: string;
  impact: string | null;
  blocksLaboratoryOperation: boolean;
  stepsTaken: string | null;
  status: IncidentStatus;
  assignee: IncidentAssigneeSnapshot | null;
  triageSummary: string | null;
  resolutionSummary: string | null;
  rejectionReason: string | null;
  verificationNote: string | null;
  version: number;
  occurredAt: string;
  reportedAt: string;
  triagedAt: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  resolvedAt: string | null;
  verifiedAt: string | null;
  closedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentPage {
  data: IncidentListItem[];
  meta: IncidentPaginationMeta;
}

export interface IncidentReportingLaboratoryDto {
  id: string;
  code: string;
  name: string;
}

export interface IncidentReportingDeviceDto {
  id: string;
  deviceCode: string;
  deviceType: string;
}

export interface IncidentReportingDevicePage {
  data: IncidentReportingDeviceDto[];
  meta: { hasMore: boolean };
}

export interface IncidentAssigneeCandidateDto {
  membershipId: string;
  user: { id: string; name: string };
}

export interface IncidentAssigneeCandidatePage {
  data: IncidentAssigneeCandidateDto[];
  meta: IncidentPaginationMeta;
}

export interface IncidentCommentDto {
  id: string;
  incidentId: string;
  actor: { userId: string; name: string };
  text: string;
  createdAt: string;
}

export interface IncidentCommentPage {
  data: IncidentCommentDto[];
  meta: IncidentPaginationMeta;
}

export interface IncidentEventDto {
  id: string;
  incidentId: string;
  ticketNumber: string;
  actor: { userId: string; membershipId: string; name: string };
  eventType: IncidentEventType;
  incidentVersionBefore: number;
  incidentVersionAfter: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface IncidentEventPage {
  data: IncidentEventDto[];
  meta: IncidentPaginationMeta;
}

export interface IncidentListFilters {
  status?: IncidentStatus;
  priority?: IncidentPriority;
  category?: IncidentCategory;
  laboratoryId?: string;
  deviceId?: string;
  assigneeMembershipId?: string;
  reportedFrom?: string;
  reportedTo?: string;
  search?: string;
  page?: number;
  perPage?: number;
}

export interface IncidentDiscoveryFilters {
  search?: string;
  page?: number;
  perPage?: number;
}

export interface IncidentPageRequest {
  page?: number;
  perPage?: number;
}

export interface CreateIncidentInput {
  submissionId: string;
  laboratoryId: string;
  deviceId: string | null;
  category: IncidentCategory;
  priority: IncidentPriority;
  title: string;
  description: string;
  impact: string | null;
  blocksLaboratoryOperation: boolean;
  stepsTaken: string | null;
  occurredAt: string;
}

export type UpdateIncidentInput = Partial<Omit<CreateIncidentInput, 'submissionId'>>;

export interface AssignIncidentInput {
  assigneeMembershipId: string;
  reason?: string | null;
}

export interface TransitionIncidentInput {
  toStatus: IncidentStatus;
  triageSummary?: string | null;
  priority?: IncidentPriority;
  impact?: string | null;
  blocksLaboratoryOperation?: boolean;
  resolutionSummary?: string | null;
  verificationNote?: string | null;
  reason?: string | null;
}

export interface IncidentGateway {
  list: (filters?: IncidentListFilters) => Promise<IncidentPage>;
  show: (incidentId: string) => Promise<IncidentDto>;
  reportingLaboratories: (filters?: IncidentDiscoveryFilters) => Promise<{ data: IncidentReportingLaboratoryDto[]; meta: IncidentPaginationMeta }>;
  reportingDevices: (laboratoryId: string, search: string) => Promise<IncidentReportingDevicePage>;
  assigneeCandidates: (filters?: IncidentDiscoveryFilters) => Promise<IncidentAssigneeCandidatePage>;
  recoverSubmission: (submissionId: string) => Promise<IncidentDto>;
  create: (input: CreateIncidentInput) => Promise<IncidentDto>;
  update: (incidentId: string, version: number, input: UpdateIncidentInput) => Promise<IncidentDto>;
  assign: (incidentId: string, version: number, input: AssignIncidentInput) => Promise<IncidentDto>;
  transition: (incidentId: string, version: number, input: TransitionIncidentInput) => Promise<IncidentDto>;
  comments: (incidentId: string, request?: IncidentPageRequest) => Promise<IncidentCommentPage>;
  addComment: (incidentId: string, version: number, text: string) => Promise<IncidentCommentDto>;
  events: (incidentId: string, request?: IncidentPageRequest) => Promise<IncidentEventPage>;
}

export class IncidentContractError extends Error {
  constructor(message = 'Respons Incident tidak sesuai kontrak API.') {
    super(message);
    this.name = 'IncidentContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(record);
  if (required.some((key) => !(key in record)) || actual.some((key) => !allowed.has(key))) {
    throw new IncidentContractError();
  }
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') throw new IncidentContractError();
  return value;
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') throw new IncidentContractError();
  return value;
}

function requiredDate(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key);
  if (Number.isNaN(Date.parse(value))) throw new IncidentContractError();
  return value;
}

function nullableDate(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new IncidentContractError();
  return value;
}

function positiveInteger(record: Record<string, unknown>, key: string, allowZero = false): number {
  const value = record[key];
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new IncidentContractError();
  return value as number;
}

function enumValue<T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) throw new IncidentContractError();
  return value as T[number];
}

function parseReporter(value: unknown): IncidentReporterSnapshot {
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, ['userId', 'name']);
  return { userId: requiredString(value, 'userId'), name: requiredString(value, 'name') };
}

function parseLaboratory(value: unknown): IncidentLaboratorySnapshot {
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, ['id', 'code', 'name']);
  return { id: requiredString(value, 'id'), code: requiredString(value, 'code'), name: requiredString(value, 'name') };
}

function parseDevice(value: unknown): IncidentDeviceSnapshot | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, ['id', 'deviceCode', 'deviceType']);
  return {
    id: requiredString(value, 'id'),
    deviceCode: requiredString(value, 'deviceCode'),
    deviceType: requiredString(value, 'deviceType'),
  };
}

function parseListAssignee(value: unknown): Omit<IncidentAssigneeSnapshot, 'membershipId'> | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, ['userId', 'name']);
  return { userId: requiredString(value, 'userId'), name: requiredString(value, 'name') };
}

function parseAssignee(value: unknown): IncidentAssigneeSnapshot | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, ['membershipId', 'userId', 'name']);
  return {
    membershipId: requiredString(value, 'membershipId'),
    userId: requiredString(value, 'userId'),
    name: requiredString(value, 'name'),
  };
}

function parsePaginationMeta(value: unknown): IncidentPaginationMeta {
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, ['page', 'perPage', 'total', 'lastPage']);
  const page = positiveInteger(value, 'page');
  const perPage = positiveInteger(value, 'perPage');
  const total = positiveInteger(value, 'total', true);
  const lastPage = positiveInteger(value, 'lastPage');
  if (perPage > 100 || page > lastPage) throw new IncidentContractError();
  return { page, perPage, total, lastPage };
}

export function parseIncidentListItem(value: unknown): IncidentListItem {
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, [
    'id', 'ticketNumber', 'reporter', 'laboratory', 'device', 'category', 'priority', 'title',
    'blocksLaboratoryOperation', 'status', 'assignee', 'version', 'occurredAt', 'reportedAt',
  ]);
  if (typeof value.blocksLaboratoryOperation !== 'boolean') throw new IncidentContractError();
  return {
    id: requiredString(value, 'id'),
    ticketNumber: requiredString(value, 'ticketNumber'),
    reporter: parseReporter(value.reporter),
    laboratory: parseLaboratory(value.laboratory),
    device: parseDevice(value.device),
    category: enumValue(value.category, INCIDENT_CATEGORIES),
    priority: enumValue(value.priority, INCIDENT_PRIORITIES),
    title: requiredString(value, 'title'),
    blocksLaboratoryOperation: value.blocksLaboratoryOperation,
    status: enumValue(value.status, INCIDENT_STATUSES),
    assignee: parseListAssignee(value.assignee),
    version: positiveInteger(value, 'version'),
    occurredAt: requiredDate(value, 'occurredAt'),
    reportedAt: requiredDate(value, 'reportedAt'),
  };
}

export function parseIncident(value: unknown): IncidentDto {
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, [
    'id', 'ticketNumber', 'reporter', 'laboratory', 'device', 'category', 'priority', 'title',
    'description', 'impact', 'blocksLaboratoryOperation', 'stepsTaken', 'status', 'assignee',
    'triageSummary', 'resolutionSummary', 'rejectionReason', 'verificationNote', 'version',
    'occurredAt', 'reportedAt', 'triagedAt', 'assignedAt', 'startedAt', 'resolvedAt',
    'verifiedAt', 'closedAt', 'rejectedAt', 'createdAt', 'updatedAt',
  ]);
  if (typeof value.blocksLaboratoryOperation !== 'boolean') throw new IncidentContractError();
  return {
    id: requiredString(value, 'id'),
    ticketNumber: requiredString(value, 'ticketNumber'),
    reporter: parseReporter(value.reporter),
    laboratory: parseLaboratory(value.laboratory),
    device: parseDevice(value.device),
    category: enumValue(value.category, INCIDENT_CATEGORIES),
    priority: enumValue(value.priority, INCIDENT_PRIORITIES),
    title: requiredString(value, 'title'),
    description: requiredString(value, 'description'),
    impact: nullableString(value, 'impact'),
    blocksLaboratoryOperation: value.blocksLaboratoryOperation,
    stepsTaken: nullableString(value, 'stepsTaken'),
    status: enumValue(value.status, INCIDENT_STATUSES),
    assignee: parseAssignee(value.assignee),
    triageSummary: nullableString(value, 'triageSummary'),
    resolutionSummary: nullableString(value, 'resolutionSummary'),
    rejectionReason: nullableString(value, 'rejectionReason'),
    verificationNote: nullableString(value, 'verificationNote'),
    version: positiveInteger(value, 'version'),
    occurredAt: requiredDate(value, 'occurredAt'),
    reportedAt: requiredDate(value, 'reportedAt'),
    triagedAt: nullableDate(value, 'triagedAt'),
    assignedAt: nullableDate(value, 'assignedAt'),
    startedAt: nullableDate(value, 'startedAt'),
    resolvedAt: nullableDate(value, 'resolvedAt'),
    verifiedAt: nullableDate(value, 'verifiedAt'),
    closedAt: nullableDate(value, 'closedAt'),
    rejectedAt: nullableDate(value, 'rejectedAt'),
    createdAt: requiredDate(value, 'createdAt'),
    updatedAt: requiredDate(value, 'updatedAt'),
  };
}

export function parseIncidentResponse(value: unknown): IncidentDto {
  if (!isRecord(value)) throw new IncidentContractError('Envelope Incident tidak valid.');
  assertExactKeys(value, ['data']);
  return parseIncident(value.data);
}

export function parseIncidentListResponse(value: unknown): IncidentPage {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new IncidentContractError('Envelope daftar Incident tidak valid.');
  assertExactKeys(value, ['data', 'meta']);
  return { data: value.data.map(parseIncidentListItem), meta: parsePaginationMeta(value.meta) };
}

function parseReportingLaboratory(value: unknown): IncidentReportingLaboratoryDto {
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, ['id', 'code', 'name']);
  return { id: requiredString(value, 'id'), code: requiredString(value, 'code'), name: requiredString(value, 'name') };
}

export function parseIncidentReportingLaboratoryResponse(value: unknown): { data: IncidentReportingLaboratoryDto[]; meta: IncidentPaginationMeta } {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new IncidentContractError();
  assertExactKeys(value, ['data', 'meta']);
  return { data: value.data.map(parseReportingLaboratory), meta: parsePaginationMeta(value.meta) };
}

function parseReportingDevice(value: unknown): IncidentReportingDeviceDto {
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, ['id', 'deviceCode', 'deviceType']);
  return {
    id: requiredString(value, 'id'),
    deviceCode: requiredString(value, 'deviceCode'),
    deviceType: requiredString(value, 'deviceType'),
  };
}

export function parseIncidentReportingDeviceResponse(value: unknown): IncidentReportingDevicePage {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.meta)) throw new IncidentContractError();
  assertExactKeys(value, ['data', 'meta']);
  assertExactKeys(value.meta, ['hasMore']);
  if (typeof value.meta.hasMore !== 'boolean' || value.data.length > 20) throw new IncidentContractError();
  return { data: value.data.map(parseReportingDevice), meta: { hasMore: value.meta.hasMore } };
}

function parseCandidate(value: unknown): IncidentAssigneeCandidateDto {
  if (!isRecord(value) || !isRecord(value.user)) throw new IncidentContractError();
  assertExactKeys(value, ['membershipId', 'user']);
  assertExactKeys(value.user, ['id', 'name']);
  return {
    membershipId: requiredString(value, 'membershipId'),
    user: { id: requiredString(value.user, 'id'), name: requiredString(value.user, 'name') },
  };
}

export function parseIncidentAssigneeCandidateResponse(value: unknown): IncidentAssigneeCandidatePage {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new IncidentContractError();
  assertExactKeys(value, ['data', 'meta']);
  return { data: value.data.map(parseCandidate), meta: parsePaginationMeta(value.meta) };
}

function parseComment(value: unknown): IncidentCommentDto {
  if (!isRecord(value) || !isRecord(value.actor)) throw new IncidentContractError();
  assertExactKeys(value, ['id', 'incidentId', 'actor', 'text', 'createdAt']);
  assertExactKeys(value.actor, ['userId', 'name']);
  return {
    id: requiredString(value, 'id'),
    incidentId: requiredString(value, 'incidentId'),
    actor: { userId: requiredString(value.actor, 'userId'), name: requiredString(value.actor, 'name') },
    text: requiredString(value, 'text'),
    createdAt: requiredDate(value, 'createdAt'),
  };
}

export function parseIncidentCommentResponse(value: unknown): IncidentCommentDto {
  if (!isRecord(value)) throw new IncidentContractError();
  assertExactKeys(value, ['data']);
  return parseComment(value.data);
}

export function parseIncidentCommentCollectionResponse(value: unknown): IncidentCommentPage {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new IncidentContractError();
  assertExactKeys(value, ['data', 'meta']);
  return { data: value.data.map(parseComment), meta: parsePaginationMeta(value.meta) };
}

function parseEvent(value: unknown): IncidentEventDto {
  if (!isRecord(value) || !isRecord(value.actor) || !isRecord(value.payload)) throw new IncidentContractError();
  assertExactKeys(value, [
    'id', 'incidentId', 'ticketNumber', 'actor', 'eventType', 'incidentVersionBefore',
    'incidentVersionAfter', 'payload', 'createdAt',
  ]);
  assertExactKeys(value.actor, ['userId', 'membershipId', 'name']);
  const before = positiveInteger(value, 'incidentVersionBefore', true);
  const after = positiveInteger(value, 'incidentVersionAfter');
  if (after !== before + 1) throw new IncidentContractError();
  return {
    id: requiredString(value, 'id'),
    incidentId: requiredString(value, 'incidentId'),
    ticketNumber: requiredString(value, 'ticketNumber'),
    actor: {
      userId: requiredString(value.actor, 'userId'),
      membershipId: requiredString(value.actor, 'membershipId'),
      name: requiredString(value.actor, 'name'),
    },
    eventType: enumValue(value.eventType, INCIDENT_EVENT_TYPES),
    incidentVersionBefore: before,
    incidentVersionAfter: after,
    payload: { ...value.payload },
    createdAt: requiredDate(value, 'createdAt'),
  };
}

export function parseIncidentEventCollectionResponse(value: unknown): IncidentEventPage {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new IncidentContractError();
  assertExactKeys(value, ['data', 'meta']);
  return { data: value.data.map(parseEvent), meta: parsePaginationMeta(value.meta) };
}

function nonEmptyIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === '') throw new IncidentContractError(`${label} tidak valid.`);
  return normalized;
}

function positiveVersion(version: number): number {
  if (!Number.isSafeInteger(version) || version < 1) throw new IncidentContractError('Versi Incident tidak valid.');
  return version;
}

export function incidentIfMatch(version: number): string {
  return `"${positiveVersion(version)}"`;
}

function appendQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix === '' ? path : `${path}?${suffix}`;
}

function pageParams(request: IncidentPageRequest = {}): Record<string, number | undefined> {
  return { page: request.page, perPage: request.perPage };
}

export function buildIncidentListPath(filters: IncidentListFilters = {}): string {
  return appendQuery('/incidents', {
    status: filters.status,
    priority: filters.priority,
    category: filters.category,
    laboratoryId: filters.laboratoryId,
    deviceId: filters.deviceId,
    assigneeMembershipId: filters.assigneeMembershipId,
    reportedFrom: filters.reportedFrom,
    reportedTo: filters.reportedTo,
    search: filters.search?.trim(),
    page: filters.page,
    perPage: filters.perPage,
  });
}

function buildDiscoveryPath(path: string, filters: IncidentDiscoveryFilters = {}): string {
  return appendQuery(path, {
    search: filters.search?.trim(),
    page: filters.page,
    perPage: filters.perPage,
  });
}

export function buildCreateIncidentPayload(input: CreateIncidentInput): CreateIncidentInput {
  return {
    submissionId: input.submissionId,
    laboratoryId: input.laboratoryId,
    deviceId: input.deviceId,
    category: input.category,
    priority: input.priority,
    title: input.title,
    description: input.description,
    impact: input.impact,
    blocksLaboratoryOperation: input.blocksLaboratoryOperation,
    stepsTaken: input.stepsTaken,
    occurredAt: input.occurredAt,
  };
}

export function buildUpdateIncidentPayload(input: UpdateIncidentInput): UpdateIncidentInput {
  const payload: UpdateIncidentInput = {};
  const keys: (keyof UpdateIncidentInput)[] = [
    'laboratoryId', 'deviceId', 'category', 'priority', 'title', 'description',
    'impact', 'blocksLaboratoryOperation', 'stepsTaken', 'occurredAt',
  ];
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined) Object.assign(payload, { [key]: value });
  }
  if (Object.keys(payload).length === 0) throw new IncidentContractError('Tidak ada field Incident yang dapat diperbarui.');
  return payload;
}

function buildAssignmentPayload(input: AssignIncidentInput): AssignIncidentInput {
  return {
    assigneeMembershipId: input.assigneeMembershipId,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };
}

function buildTransitionPayload(input: TransitionIncidentInput): TransitionIncidentInput {
  const payload: TransitionIncidentInput = { toStatus: input.toStatus };
  const keys: (keyof Omit<TransitionIncidentInput, 'toStatus'>)[] = [
    'triageSummary', 'priority', 'impact', 'blocksLaboratoryOperation',
    'resolutionSummary', 'verificationNote', 'reason',
  ];
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined) Object.assign(payload, { [key]: value });
  }
  return payload;
}

export function createIncidentGateway(client: ApiClient): IncidentGateway {
  return {
    async list(filters = {}) {
      return parseIncidentListResponse(await client.get<unknown>(buildIncidentListPath(filters)));
    },
    async show(incidentId) {
      const id = nonEmptyIdentifier(incidentId, 'ID Incident');
      return parseIncidentResponse(await client.get<unknown>(`/incidents/${encodeURIComponent(id)}`));
    },
    async reportingLaboratories(filters = {}) {
      return parseIncidentReportingLaboratoryResponse(await client.get<unknown>(
        buildDiscoveryPath('/incidents/reporting-context/laboratories', filters),
      ));
    },
    async reportingDevices(laboratoryId, search) {
      const labId = nonEmptyIdentifier(laboratoryId, 'ID Laboratory');
      const normalizedSearch = search.trim();
      if (normalizedSearch.length < 2 || normalizedSearch.length > 100) {
        throw new IncidentContractError('Pencarian Device Incident harus 2-100 karakter.');
      }
      return parseIncidentReportingDeviceResponse(await client.get<unknown>(
        appendQuery(`/incidents/reporting-context/laboratories/${encodeURIComponent(labId)}/devices`, { search: normalizedSearch }),
      ));
    },
    async assigneeCandidates(filters = {}) {
      return parseIncidentAssigneeCandidateResponse(await client.get<unknown>(
        buildDiscoveryPath('/incidents/assignee-candidates', filters),
      ));
    },
    async recoverSubmission(submissionId) {
      const id = nonEmptyIdentifier(submissionId, 'Submission ID');
      return parseIncidentResponse(await client.get<unknown>(`/incidents/submissions/${encodeURIComponent(id)}`));
    },
    async create(input) {
      return parseIncidentResponse(await client.post<unknown>('/incidents', buildCreateIncidentPayload(input)));
    },
    async update(incidentId, version, input) {
      const id = nonEmptyIdentifier(incidentId, 'ID Incident');
      return parseIncidentResponse(await client.patch<unknown>(
        `/incidents/${encodeURIComponent(id)}`,
        buildUpdateIncidentPayload(input),
        { ifMatch: incidentIfMatch(version) },
      ));
    },
    async assign(incidentId, version, input) {
      const id = nonEmptyIdentifier(incidentId, 'ID Incident');
      return parseIncidentResponse(await client.post<unknown>(
        `/incidents/${encodeURIComponent(id)}/assignments`,
        buildAssignmentPayload(input),
        { ifMatch: incidentIfMatch(version) },
      ));
    },
    async transition(incidentId, version, input) {
      const id = nonEmptyIdentifier(incidentId, 'ID Incident');
      return parseIncidentResponse(await client.post<unknown>(
        `/incidents/${encodeURIComponent(id)}/transitions`,
        buildTransitionPayload(input),
        { ifMatch: incidentIfMatch(version) },
      ));
    },
    async comments(incidentId, request = {}) {
      const id = nonEmptyIdentifier(incidentId, 'ID Incident');
      return parseIncidentCommentCollectionResponse(await client.get<unknown>(
        appendQuery(`/incidents/${encodeURIComponent(id)}/comments`, pageParams(request)),
      ));
    },
    async addComment(incidentId, version, text) {
      const id = nonEmptyIdentifier(incidentId, 'ID Incident');
      return parseIncidentCommentResponse(await client.post<unknown>(
        `/incidents/${encodeURIComponent(id)}/comments`,
        { text },
        { ifMatch: incidentIfMatch(version) },
      ));
    },
    async events(incidentId, request = {}) {
      const id = nonEmptyIdentifier(incidentId, 'ID Incident');
      return parseIncidentEventCollectionResponse(await client.get<unknown>(
        appendQuery(`/incidents/${encodeURIComponent(id)}/events`, pageParams(request)),
      ));
    },
  };
}

export const incidentGateway = createIncidentGateway(apiClient);
