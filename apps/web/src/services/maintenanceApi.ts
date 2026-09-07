import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';
import { ASSET_CONDITIONS, type AssetCondition } from '@/services/assetApi';

export const MAINTENANCE_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'semester', 'yearly', 'custom_interval'] as const;
export const MAINTENANCE_PLAN_STATUSES = ['active', 'inactive'] as const;
export const MAINTENANCE_EXECUTION_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;

export type MaintenanceFrequency = (typeof MAINTENANCE_FREQUENCIES)[number];
export type MaintenancePlanStatus = (typeof MAINTENANCE_PLAN_STATUSES)[number];
export type MaintenanceExecutionStatus = (typeof MAINTENANCE_EXECUTION_STATUSES)[number];

export interface MaintenancePlanDto {
  id: string;
  schoolId: string;
  planCode: string;
  assetId: string;
  assetCodeSnapshot: string;
  assetNameSnapshot: string;
  name: string;
  frequencyKind: MaintenanceFrequency;
  intervalDays: number | null;
  checklistTemplate: string[];
  assignedTechnicianReference: string | null;
  assignedTechnicianNameSnapshot: string | null;
  nextDueDate: string;
  status: MaintenancePlanStatus;
  isOverdue: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceInventoryTransactionDto {
  id: string;
  inventoryItemId: string;
  clientMutationId: string;
  quantity: number;
  signedDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  itemCodeSnapshot: string;
  itemNameSnapshot: string;
  unitSnapshot: string;
  occurredAt: string;
}

export interface MaintenanceChecklistResult {
  item: string;
  done: boolean;
}

export interface MaintenanceExecutionDto {
  id: string;
  schoolId: string;
  executionNumber: string;
  maintenancePlanId: string;
  planCodeSnapshot: string;
  assetId: string;
  assetCodeSnapshot: string;
  assetNameSnapshot: string;
  scheduledFor: string;
  status: MaintenanceExecutionStatus;
  checklistSnapshot: string[];
  checklistResults: MaintenanceChecklistResult[] | null;
  checklistProgress: MaintenanceChecklistResult[] | null;
  findings: string | null;
  actionTaken: string | null;
  conditionBefore: AssetCondition | null;
  conditionAfter: AssetCondition | null;
  technicianReference: string | null;
  technicianNameSnapshot: string;
  assetVersionAtStart: number | null;
  custodyActive: boolean;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  version: number;
  inventoryTransactions: MaintenanceInventoryTransactionDto[];
  createdAt: string;
  updatedAt: string;
}

export interface MaintenancePage<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; lastPage: number };
}

export interface CreateMaintenancePlanInput {
  assetId: string;
  name: string;
  frequencyKind: MaintenanceFrequency;
  intervalDays?: number | null;
  checklistTemplate: string[];
  assignedTechnicianReference?: string | null;
  assignedTechnicianName?: string | null;
  nextDueDate: string;
}

export interface UpdateMaintenancePlanInput {
  name?: string;
  frequencyKind?: MaintenanceFrequency;
  intervalDays?: number | null;
  checklistTemplate?: string[];
  assignedTechnicianReference?: string | null;
  assignedTechnicianName?: string | null;
  nextDueDate?: string;
}

export interface ScheduleMaintenanceExecutionInput {
  scheduledFor: string;
  technicianReference?: string | null;
  technicianName: string;
}

export interface CompleteMaintenanceInventoryIssueInput {
  inventoryItemId: string;
  clientMutationId: string;
  quantity: number;
}

export interface UpdateMaintenanceChecklistProgressInput {
  checklistResults: boolean[];
}

export interface CompleteMaintenanceExecutionInput {
  checklistResults: boolean[];
  findings?: string | null;
  actionTaken: string;
  conditionAfter: AssetCondition;
  inventoryIssues?: CompleteMaintenanceInventoryIssueInput[];
}

export interface MaintenanceGateway {
  listPlans: () => Promise<MaintenancePage<MaintenancePlanDto>>;
  listAllPlans: () => Promise<MaintenancePlanDto[]>;
  showPlan: (planId: string) => Promise<MaintenancePlanDto>;
  createPlan: (input: CreateMaintenancePlanInput) => Promise<MaintenancePlanDto>;
  updatePlan: (planId: string, expectedVersion: number, input: UpdateMaintenancePlanInput) => Promise<MaintenancePlanDto>;
  activatePlan: (planId: string, expectedVersion: number) => Promise<MaintenancePlanDto>;
  deactivatePlan: (planId: string, expectedVersion: number) => Promise<MaintenancePlanDto>;
  scheduleExecution: (planId: string, expectedPlanVersion: number, input: ScheduleMaintenanceExecutionInput) => Promise<MaintenanceExecutionDto>;
  listExecutions: () => Promise<MaintenancePage<MaintenanceExecutionDto>>;
  listAllExecutions: () => Promise<MaintenanceExecutionDto[]>;
  showExecution: (executionId: string) => Promise<MaintenanceExecutionDto>;
  startExecution: (executionId: string, expectedVersion: number) => Promise<MaintenanceExecutionDto>;
  updateChecklistProgress: (executionId: string, expectedVersion: number, input: UpdateMaintenanceChecklistProgressInput) => Promise<MaintenanceExecutionDto>;
  completeExecution: (executionId: string, expectedVersion: number, input: CompleteMaintenanceExecutionInput) => Promise<MaintenanceExecutionDto>;
  cancelExecution: (executionId: string, expectedVersion: number, reason: string) => Promise<MaintenanceExecutionDto>;
}

export class MaintenanceContractError extends Error {
  constructor(message = 'Respons Preventive Maintenance tidak sesuai kontrak API.') {
    super(message);
    this.name = 'MaintenanceContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, fields: readonly string[], message?: string): void {
  const keys = Object.keys(record);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new MaintenanceContractError(message);
  }
}

function stringField(record: Record<string, unknown>, field: string, max = 5000): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new MaintenanceContractError();
  return value;
}

function nullableString(record: Record<string, unknown>, field: string, max = 5000): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw new MaintenanceContractError();
  return value;
}

function ulidField(record: Record<string, unknown>, field: string): string {
  const value = stringField(record, field);
  if (!isUlid(value)) throw new MaintenanceContractError();
  return value;
}

function dateField(record: Record<string, unknown>, field: string): string {
  const value = stringField(record, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new MaintenanceContractError();
  }
  return value;
}

function dateTime(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new MaintenanceContractError();
  return value;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const PLAN_FIELDS = [
  'id', 'schoolId', 'planCode', 'assetId', 'assetCodeSnapshot', 'assetNameSnapshot',
  'name', 'frequencyKind', 'intervalDays', 'checklistTemplate',
  'assignedTechnicianReference', 'assignedTechnicianNameSnapshot', 'nextDueDate',
  'status', 'isOverdue', 'version', 'createdAt', 'updatedAt',
] as const;

export function parseMaintenancePlan(value: unknown): MaintenancePlanDto {
  if (!isRecord(value)) throw new MaintenanceContractError();
  exactKeys(value, PLAN_FIELDS);
  if (!(MAINTENANCE_FREQUENCIES as readonly unknown[]).includes(value.frequencyKind)) throw new MaintenanceContractError();
  if (!(MAINTENANCE_PLAN_STATUSES as readonly unknown[]).includes(value.status)) throw new MaintenanceContractError();
  if (typeof value.isOverdue !== 'boolean' || !positiveInteger(value.version)) throw new MaintenanceContractError();
  if (value.intervalDays !== null && !positiveInteger(value.intervalDays)) throw new MaintenanceContractError();
  if (!Array.isArray(value.checklistTemplate) || value.checklistTemplate.length < 1
      || value.checklistTemplate.some((item) => typeof item !== 'string' || item.trim() === '')) throw new MaintenanceContractError();

  return {
    id: ulidField(value, 'id'),
    schoolId: ulidField(value, 'schoolId'),
    planCode: stringField(value, 'planCode', 48),
    assetId: ulidField(value, 'assetId'),
    assetCodeSnapshot: stringField(value, 'assetCodeSnapshot', 64),
    assetNameSnapshot: stringField(value, 'assetNameSnapshot', 255),
    name: stringField(value, 'name', 255),
    frequencyKind: value.frequencyKind as MaintenanceFrequency,
    intervalDays: value.intervalDays as number | null,
    checklistTemplate: [...value.checklistTemplate] as string[],
    assignedTechnicianReference: nullableString(value, 'assignedTechnicianReference', 255),
    assignedTechnicianNameSnapshot: nullableString(value, 'assignedTechnicianNameSnapshot', 255),
    nextDueDate: dateField(value, 'nextDueDate'),
    status: value.status as MaintenancePlanStatus,
    isOverdue: value.isOverdue,
    version: value.version,
    createdAt: dateTime(value.createdAt) as string,
    updatedAt: dateTime(value.updatedAt) as string,
  };
}

const INVENTORY_EVIDENCE_FIELDS = [
  'id', 'inventoryItemId', 'clientMutationId', 'quantity', 'signedDelta',
  'balanceBefore', 'balanceAfter', 'itemCodeSnapshot', 'itemNameSnapshot',
  'unitSnapshot', 'occurredAt',
] as const;

function parseInventoryEvidence(value: unknown): MaintenanceInventoryTransactionDto {
  if (!isRecord(value)) throw new MaintenanceContractError();
  exactKeys(value, INVENTORY_EVIDENCE_FIELDS);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stringField(value, 'clientMutationId'))) {
    throw new MaintenanceContractError();
  }
  for (const field of ['quantity', 'signedDelta', 'balanceBefore', 'balanceAfter'] as const) {
    if (!finiteNumber(value[field])) throw new MaintenanceContractError();
  }
  if ((value.quantity as number) <= 0 || (value.signedDelta as number) >= 0
      || (value.balanceBefore as number) < 0 || (value.balanceAfter as number) < 0) throw new MaintenanceContractError();

  return {
    id: ulidField(value, 'id'),
    inventoryItemId: ulidField(value, 'inventoryItemId'),
    clientMutationId: value.clientMutationId as string,
    quantity: value.quantity as number,
    signedDelta: value.signedDelta as number,
    balanceBefore: value.balanceBefore as number,
    balanceAfter: value.balanceAfter as number,
    itemCodeSnapshot: stringField(value, 'itemCodeSnapshot', 32),
    itemNameSnapshot: stringField(value, 'itemNameSnapshot', 255),
    unitSnapshot: stringField(value, 'unitSnapshot', 32),
    occurredAt: dateTime(value.occurredAt) as string,
  };
}

const EXECUTION_FIELDS = [
  'id', 'schoolId', 'executionNumber', 'maintenancePlanId', 'planCodeSnapshot',
  'assetId', 'assetCodeSnapshot', 'assetNameSnapshot', 'scheduledFor', 'status',
  'checklistSnapshot', 'checklistResults', 'checklistProgress', 'findings', 'actionTaken',
  'conditionBefore', 'conditionAfter', 'technicianReference', 'technicianNameSnapshot',
  'assetVersionAtStart', 'custodyActive', 'startedAt', 'completedAt', 'cancelledAt',
  'cancelReason', 'version', 'inventoryTransactions', 'createdAt', 'updatedAt',
] as const;

export function parseMaintenanceExecution(value: unknown): MaintenanceExecutionDto {
  if (!isRecord(value)) throw new MaintenanceContractError();
  exactKeys(value, EXECUTION_FIELDS);
  if (!(MAINTENANCE_EXECUTION_STATUSES as readonly unknown[]).includes(value.status)) throw new MaintenanceContractError();
  if (!Array.isArray(value.checklistSnapshot) || value.checklistSnapshot.length < 1
      || value.checklistSnapshot.some((item) => typeof item !== 'string' || item.trim() === '')) throw new MaintenanceContractError();
  for (const field of ['checklistResults', 'checklistProgress'] as const) {
    const evidence = value[field];
    if (evidence === null) continue;
    if (!Array.isArray(evidence) || evidence.length !== value.checklistSnapshot.length) throw new MaintenanceContractError();
    for (const result of evidence) {
      if (!isRecord(result)) throw new MaintenanceContractError();
      exactKeys(result, ['item', 'done']);
      if (typeof result.item !== 'string' || typeof result.done !== 'boolean') throw new MaintenanceContractError();
    }
  }
  if (value.conditionBefore !== null && !(ASSET_CONDITIONS as readonly unknown[]).includes(value.conditionBefore)) throw new MaintenanceContractError();
  if (value.conditionAfter !== null && !(ASSET_CONDITIONS as readonly unknown[]).includes(value.conditionAfter)) throw new MaintenanceContractError();
  if (value.assetVersionAtStart !== null && !positiveInteger(value.assetVersionAtStart)) throw new MaintenanceContractError();
  if (typeof value.custodyActive !== 'boolean' || !positiveInteger(value.version)) throw new MaintenanceContractError();
  if (!Array.isArray(value.inventoryTransactions)) throw new MaintenanceContractError();

  return {
    id: ulidField(value, 'id'),
    schoolId: ulidField(value, 'schoolId'),
    executionNumber: stringField(value, 'executionNumber', 48),
    maintenancePlanId: ulidField(value, 'maintenancePlanId'),
    planCodeSnapshot: stringField(value, 'planCodeSnapshot', 48),
    assetId: ulidField(value, 'assetId'),
    assetCodeSnapshot: stringField(value, 'assetCodeSnapshot', 64),
    assetNameSnapshot: stringField(value, 'assetNameSnapshot', 255),
    scheduledFor: dateField(value, 'scheduledFor'),
    status: value.status as MaintenanceExecutionStatus,
    checklistSnapshot: [...value.checklistSnapshot] as string[],
    checklistResults: value.checklistResults === null
      ? null
      : (value.checklistResults as Array<Record<string, unknown>>).map((item) => ({ item: item.item as string, done: item.done as boolean })),
    checklistProgress: value.checklistProgress === null
      ? null
      : (value.checklistProgress as Array<Record<string, unknown>>).map((item) => ({ item: item.item as string, done: item.done as boolean })),
    findings: nullableString(value, 'findings'),
    actionTaken: nullableString(value, 'actionTaken'),
    conditionBefore: value.conditionBefore as AssetCondition | null,
    conditionAfter: value.conditionAfter as AssetCondition | null,
    technicianReference: nullableString(value, 'technicianReference', 255),
    technicianNameSnapshot: stringField(value, 'technicianNameSnapshot', 255),
    assetVersionAtStart: value.assetVersionAtStart as number | null,
    custodyActive: value.custodyActive,
    startedAt: dateTime(value.startedAt, true),
    completedAt: dateTime(value.completedAt, true),
    cancelledAt: dateTime(value.cancelledAt, true),
    cancelReason: nullableString(value, 'cancelReason', 1000),
    version: value.version,
    inventoryTransactions: value.inventoryTransactions.map(parseInventoryEvidence),
    createdAt: dateTime(value.createdAt) as string,
    updatedAt: dateTime(value.updatedAt) as string,
  };
}

function parsePage<T>(value: unknown, parser: (input: unknown) => T): MaintenancePage<T> {
  if (!isRecord(value)) throw new MaintenanceContractError('Envelope koleksi Maintenance tidak valid.');
  exactKeys(value, ['data', 'meta'], 'Envelope koleksi Maintenance tidak valid.');
  if (!Array.isArray(value.data) || !isRecord(value.meta)) throw new MaintenanceContractError('Envelope koleksi Maintenance tidak valid.');
  exactKeys(value.meta, ['page', 'perPage', 'total', 'lastPage']);
  const { page, perPage, total, lastPage } = value.meta;
  if (!positiveInteger(page) || !positiveInteger(perPage) || perPage > 200 || !nonNegativeInteger(total) || !positiveInteger(lastPage)) {
    throw new MaintenanceContractError('Metadata koleksi Maintenance tidak valid.');
  }
  return { data: value.data.map(parser), meta: { page, perPage, total, lastPage } };
}

function parsePlanResponse(value: unknown): MaintenancePlanDto {
  if (!isRecord(value)) throw new MaintenanceContractError('Envelope MaintenancePlan tidak valid.');
  exactKeys(value, ['data']);
  return parseMaintenancePlan(value.data);
}

function parseExecutionResponse(value: unknown): MaintenanceExecutionDto {
  if (!isRecord(value)) throw new MaintenanceContractError('Envelope MaintenanceExecution tidak valid.');
  exactKeys(value, ['data']);
  return parseMaintenanceExecution(value.data);
}

export function maintenanceIfMatch(version: number): string {
  if (!positiveInteger(version)) throw new MaintenanceContractError('Versi Maintenance tidak valid.');
  return `"${version}"`;
}

function planPath(planId: string): string {
  if (!isUlid(planId)) throw new MaintenanceContractError('ID MaintenancePlan tidak valid.');
  return `/maintenance-plans/${encodeURIComponent(planId)}`;
}

function executionPath(executionId: string): string {
  if (!isUlid(executionId)) throw new MaintenanceContractError('ID MaintenanceExecution tidak valid.');
  return `/maintenance-executions/${encodeURIComponent(executionId)}`;
}

export function createMaintenanceGateway(client: ApiClient): MaintenanceGateway {
  return {
    async listPlans() {
      return parsePage(await client.get<unknown>('/maintenance-plans?perPage=200'), parseMaintenancePlan);
    },
    async listAllPlans() {
      const first = parsePage(await client.get<unknown>('/maintenance-plans?perPage=200&page=1'), parseMaintenancePlan);
      if (first.meta.lastPage === 1) return first.data;
      const pages = await Promise.all(Array.from({ length: first.meta.lastPage - 1 }, (_, index) =>
        client.get<unknown>(`/maintenance-plans?perPage=200&page=${index + 2}`)));
      return [...first.data, ...pages.flatMap((page) => parsePage(page, parseMaintenancePlan).data)];
    },
    async showPlan(planId) {
      return parsePlanResponse(await client.get<unknown>(planPath(planId)));
    },
    async createPlan(input) {
      return parsePlanResponse(await client.post<unknown>('/maintenance-plans', input));
    },
    async updatePlan(planId, expectedVersion, input) {
      return parsePlanResponse(await client.patch<unknown>(planPath(planId), input, { ifMatch: maintenanceIfMatch(expectedVersion) }));
    },
    async activatePlan(planId, expectedVersion) {
      return parsePlanResponse(await client.post<unknown>(`${planPath(planId)}/activate`, {}, { ifMatch: maintenanceIfMatch(expectedVersion) }));
    },
    async deactivatePlan(planId, expectedVersion) {
      return parsePlanResponse(await client.post<unknown>(`${planPath(planId)}/deactivate`, {}, { ifMatch: maintenanceIfMatch(expectedVersion) }));
    },
    async scheduleExecution(planId, expectedPlanVersion, input) {
      return parseExecutionResponse(await client.post<unknown>(
        `${planPath(planId)}/executions`,
        input,
        { ifMatch: maintenanceIfMatch(expectedPlanVersion) },
      ));
    },
    async listExecutions() {
      return parsePage(await client.get<unknown>('/maintenance-executions?perPage=200'), parseMaintenanceExecution);
    },
    async listAllExecutions() {
      const first = parsePage(await client.get<unknown>('/maintenance-executions?perPage=200&page=1'), parseMaintenanceExecution);
      if (first.meta.lastPage === 1) return first.data;
      const pages = await Promise.all(Array.from({ length: first.meta.lastPage - 1 }, (_, index) =>
        client.get<unknown>(`/maintenance-executions?perPage=200&page=${index + 2}`)));
      return [...first.data, ...pages.flatMap((page) => parsePage(page, parseMaintenanceExecution).data)];
    },
    async showExecution(executionId) {
      return parseExecutionResponse(await client.get<unknown>(executionPath(executionId)));
    },
    async startExecution(executionId, expectedVersion) {
      return parseExecutionResponse(await client.post<unknown>(
        `${executionPath(executionId)}/start`,
        {},
        { ifMatch: maintenanceIfMatch(expectedVersion) },
      ));
    },
    async updateChecklistProgress(executionId, expectedVersion, input) {
      return parseExecutionResponse(await client.patch<unknown>(
        `${executionPath(executionId)}/checklist-progress`,
        input,
        { ifMatch: maintenanceIfMatch(expectedVersion) },
      ));
    },
    async completeExecution(executionId, expectedVersion, input) {
      return parseExecutionResponse(await client.post<unknown>(
        `${executionPath(executionId)}/complete`,
        input,
        { ifMatch: maintenanceIfMatch(expectedVersion) },
      ));
    },
    async cancelExecution(executionId, expectedVersion, reason) {
      return parseExecutionResponse(await client.post<unknown>(
        `${executionPath(executionId)}/cancel`,
        { reason },
        { ifMatch: maintenanceIfMatch(expectedVersion) },
      ));
    },
  };
}

export const maintenanceGateway = createMaintenanceGateway(apiClient);
