import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';
import type { AssetCondition } from '@/services/assetApi';

export const WORK_ORDER_STATUSES = [
  'draft', 'assigned', 'in_progress', 'on_hold', 'waiting_part', 'completed', 'verified', 'cancelled',
] as const;
export const WORK_ORDER_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export interface WorkOrderDto {
  id: string;
  schoolId: string;
  workOrderNumber: string;
  incidentId: string | null;
  incidentTicketSnapshot: string | null;
  assetId: string;
  assetCodeSnapshot: string;
  assetNameSnapshot: string;
  laboratoryId: string;
  laboratoryCodeSnapshot: string;
  laboratoryNameSnapshot: string;
  problemSummary: string;
  priority: WorkOrderPriority;
  scheduledFor: string | null;
  notes: string | null;
  status: WorkOrderStatus;
  assigneeMembershipId: string | null;
  assigneeUserIdSnapshot: string | null;
  assigneeMembershipIdSnapshot: string | null;
  assigneeNameSnapshot: string | null;
  diagnosis: string | null;
  actionTaken: string | null;
  testResult: string | null;
  conditionBefore: AssetCondition | null;
  conditionAfter: AssetCondition | null;
  assetVersionAtStart: number | null;
  custodyActive: boolean;
  startedAt: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderEventDto {
  id: string;
  workOrderId: string;
  actorUserIdSnapshot: string;
  actorMembershipIdSnapshot: string;
  actorNameSnapshot: string;
  eventType: string;
  beforeStatus: WorkOrderStatus | null;
  afterStatus: WorkOrderStatus;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkOrderPartUsageDto {
  id: string;
  schoolId: string;
  workOrderId: string;
  inventoryTransactionId: string;
  inventoryItemId: string;
  clientMutationId: string;
  itemCodeSnapshot: string;
  itemNameSnapshot: string;
  unitSnapshot: string;
  quantity: number;
  actorUserIdSnapshot: string;
  actorMembershipIdSnapshot: string;
  actorNameSnapshot: string;
  usedAt: string;
  createdAt: string;
}

export interface WorkOrderPage {
  data: WorkOrderDto[];
  meta: { page: number; perPage: number; total: number; lastPage: number };
}

export interface CreateWorkOrderInput {
  assetId: string;
  laboratoryId: string;
  incidentId?: string | null;
  problemSummary: string;
  priority?: WorkOrderPriority;
  scheduledFor?: string | null;
  notes?: string | null;
}

export interface UpdateWorkOrderInput {
  problemSummary?: string;
  priority?: WorkOrderPriority;
  scheduledFor?: string | null;
  notes?: string | null;
}

export interface AssignWorkOrderInput {
  assigneeMembershipId: string;
  reason?: string | null;
}

export interface CompleteWorkOrderInput {
  diagnosis: string;
  actionTaken: string;
  conditionAfter: AssetCondition;
  testResult?: string | null;
}

export interface UseWorkOrderPartInput {
  inventoryItemId: string;
  clientMutationId: string;
  quantity: number;
}

export interface WorkOrderPartResult {
  workOrder: WorkOrderDto;
  partUsage: WorkOrderPartUsageDto;
  replayed: boolean;
}

export interface WorkOrderGateway {
  list: () => Promise<WorkOrderPage>;
  listAll: () => Promise<WorkOrderDto[]>;
  show: (id: string) => Promise<WorkOrderDto>;
  history: (id: string) => Promise<WorkOrderEventDto[]>;
  create: (input: CreateWorkOrderInput) => Promise<WorkOrderDto>;
  update: (id: string, version: number, input: UpdateWorkOrderInput) => Promise<WorkOrderDto>;
  assign: (id: string, version: number, input: AssignWorkOrderInput) => Promise<WorkOrderDto>;
  start: (id: string, version: number) => Promise<WorkOrderDto>;
  hold: (id: string, version: number, reason: string) => Promise<WorkOrderDto>;
  waitingPart: (id: string, version: number, reason: string) => Promise<WorkOrderDto>;
  resume: (id: string, version: number) => Promise<WorkOrderDto>;
  usePart: (id: string, version: number, input: UseWorkOrderPartInput) => Promise<WorkOrderPartResult>;
  complete: (id: string, version: number, input: CompleteWorkOrderInput) => Promise<WorkOrderDto>;
  verify: (id: string, version: number) => Promise<WorkOrderDto>;
  rework: (id: string, version: number, reason: string) => Promise<WorkOrderDto>;
  cancel: (id: string, version: number, reason: string) => Promise<WorkOrderDto>;
}

export class WorkOrderContractError extends Error {
  constructor(message = 'Respons Work Order tidak sesuai kontrak API.') {
    super(message);
    this.name = 'WorkOrderContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(record: Record<string, unknown>, fields: readonly string[]): void {
  const keys = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new WorkOrderContractError();
}
function str(record: Record<string, unknown>, field: string, max = 5000): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new WorkOrderContractError();
  return value;
}
function nullableStr(record: Record<string, unknown>, field: string, max = 5000): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw new WorkOrderContractError();
  return value;
}
function ulid(record: Record<string, unknown>, field: string): string {
  const value = str(record, field, 64);
  if (!isUlid(value)) throw new WorkOrderContractError();
  return value;
}
function nullableUlid(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || !isUlid(value)) throw new WorkOrderContractError();
  return value;
}
function dateTime(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new WorkOrderContractError();
  return value;
}
function dateValue(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value+'T00:00:00Z'))) throw new WorkOrderContractError();
  return value;
}
function positiveInt(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function nonNegativeInt(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
const CONDITIONS = ['good','minor_damage','moderate_damage','major_damage','unknown'] as const;

const WORK_ORDER_FIELDS = [
  'id','schoolId','workOrderNumber','incidentId','incidentTicketSnapshot','assetId','assetCodeSnapshot','assetNameSnapshot',
  'laboratoryId','laboratoryCodeSnapshot','laboratoryNameSnapshot','problemSummary','priority','scheduledFor','notes','status',
  'assigneeMembershipId','assigneeUserIdSnapshot','assigneeMembershipIdSnapshot','assigneeNameSnapshot','diagnosis','actionTaken',
  'testResult','conditionBefore','conditionAfter','assetVersionAtStart','custodyActive','startedAt','completedAt','verifiedAt',
  'cancelledAt','cancelReason','version','createdAt','updatedAt',
] as const;

export function parseWorkOrder(value: unknown): WorkOrderDto {
  if (!isRecord(value)) throw new WorkOrderContractError();
  exact(value, WORK_ORDER_FIELDS);
  if (!(WORK_ORDER_STATUSES as readonly unknown[]).includes(value.status)) throw new WorkOrderContractError();
  if (!(WORK_ORDER_PRIORITIES as readonly unknown[]).includes(value.priority)) throw new WorkOrderContractError();
  for (const field of ['conditionBefore','conditionAfter'] as const) {
    if (value[field] !== null && !(CONDITIONS as readonly unknown[]).includes(value[field])) throw new WorkOrderContractError();
  }
  if (typeof value.custodyActive !== 'boolean' || !positiveInt(value.version)) throw new WorkOrderContractError();
  if (value.assetVersionAtStart !== null && !positiveInt(value.assetVersionAtStart)) throw new WorkOrderContractError();

  return {
    id: ulid(value,'id'), schoolId: ulid(value,'schoolId'), workOrderNumber: str(value,'workOrderNumber',48),
    incidentId: nullableUlid(value,'incidentId'), incidentTicketSnapshot: nullableStr(value,'incidentTicketSnapshot',64),
    assetId: ulid(value,'assetId'), assetCodeSnapshot: str(value,'assetCodeSnapshot',64), assetNameSnapshot: str(value,'assetNameSnapshot',255),
    laboratoryId: ulid(value,'laboratoryId'), laboratoryCodeSnapshot: str(value,'laboratoryCodeSnapshot',64), laboratoryNameSnapshot: str(value,'laboratoryNameSnapshot',255),
    problemSummary: str(value,'problemSummary',2000), priority: value.priority as WorkOrderPriority, scheduledFor: dateValue(value.scheduledFor), notes: nullableStr(value,'notes',2000),
    status: value.status as WorkOrderStatus, assigneeMembershipId: nullableUlid(value,'assigneeMembershipId'),
    assigneeUserIdSnapshot: nullableUlid(value,'assigneeUserIdSnapshot'), assigneeMembershipIdSnapshot: nullableUlid(value,'assigneeMembershipIdSnapshot'),
    assigneeNameSnapshot: nullableStr(value,'assigneeNameSnapshot',255), diagnosis: nullableStr(value,'diagnosis',2000),
    actionTaken: nullableStr(value,'actionTaken',2000), testResult: nullableStr(value,'testResult',2000),
    conditionBefore: value.conditionBefore as AssetCondition | null, conditionAfter: value.conditionAfter as AssetCondition | null,
    assetVersionAtStart: value.assetVersionAtStart as number | null, custodyActive: value.custodyActive,
    startedAt: dateTime(value.startedAt,true), completedAt: dateTime(value.completedAt,true), verifiedAt: dateTime(value.verifiedAt,true),
    cancelledAt: dateTime(value.cancelledAt,true), cancelReason: nullableStr(value,'cancelReason',1000), version: value.version,
    createdAt: dateTime(value.createdAt) as string, updatedAt: dateTime(value.updatedAt) as string,
  };
}

const EVENT_FIELDS = ['id','workOrderId','actorUserIdSnapshot','actorMembershipIdSnapshot','actorNameSnapshot','eventType','beforeStatus','afterStatus','payload','createdAt'] as const;
export function parseWorkOrderEvent(value: unknown): WorkOrderEventDto {
  if (!isRecord(value)) throw new WorkOrderContractError();
  exact(value, EVENT_FIELDS);
  if (value.beforeStatus !== null && !(WORK_ORDER_STATUSES as readonly unknown[]).includes(value.beforeStatus)) throw new WorkOrderContractError();
  if (!(WORK_ORDER_STATUSES as readonly unknown[]).includes(value.afterStatus) || !isRecord(value.payload)) throw new WorkOrderContractError();
  return {
    id: ulid(value,'id'), workOrderId: ulid(value,'workOrderId'), actorUserIdSnapshot: ulid(value,'actorUserIdSnapshot'),
    actorMembershipIdSnapshot: ulid(value,'actorMembershipIdSnapshot'), actorNameSnapshot: str(value,'actorNameSnapshot',255),
    eventType: str(value,'eventType',120), beforeStatus: value.beforeStatus as WorkOrderStatus | null,
    afterStatus: value.afterStatus as WorkOrderStatus, payload: {...value.payload}, createdAt: dateTime(value.createdAt) as string,
  };
}

const PART_FIELDS = ['id','schoolId','workOrderId','inventoryTransactionId','inventoryItemId','clientMutationId','itemCodeSnapshot','itemNameSnapshot','unitSnapshot','quantity','actorUserIdSnapshot','actorMembershipIdSnapshot','actorNameSnapshot','usedAt','createdAt'] as const;
export function parseWorkOrderPartUsage(value: unknown): WorkOrderPartUsageDto {
  if (!isRecord(value)) throw new WorkOrderContractError();
  exact(value, PART_FIELDS);
  if (!uuid(value.clientMutationId) || typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity <= 0) throw new WorkOrderContractError();
  return {
    id: ulid(value,'id'), schoolId: ulid(value,'schoolId'), workOrderId: ulid(value,'workOrderId'),
    inventoryTransactionId: ulid(value,'inventoryTransactionId'), inventoryItemId: ulid(value,'inventoryItemId'),
    clientMutationId: value.clientMutationId, itemCodeSnapshot: str(value,'itemCodeSnapshot',32),
    itemNameSnapshot: str(value,'itemNameSnapshot',255), unitSnapshot: str(value,'unitSnapshot',32), quantity: value.quantity,
    actorUserIdSnapshot: ulid(value,'actorUserIdSnapshot'), actorMembershipIdSnapshot: ulid(value,'actorMembershipIdSnapshot'),
    actorNameSnapshot: str(value,'actorNameSnapshot',255), usedAt: dateTime(value.usedAt) as string, createdAt: dateTime(value.createdAt) as string,
  };
}

function response(value: unknown): WorkOrderDto {
  if (!isRecord(value)) throw new WorkOrderContractError();
  exact(value,['data']);
  return parseWorkOrder(value.data);
}
function page(value: unknown): WorkOrderPage {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.meta)) throw new WorkOrderContractError();
  exact(value,['data','meta']); exact(value.meta,['page','perPage','total','lastPage']);
  const {page:pn,perPage,total,lastPage}=value.meta;
  if (!positiveInt(pn)||!positiveInt(perPage)||perPage>200||!nonNegativeInt(total)||!positiveInt(lastPage)) throw new WorkOrderContractError();
  return {data:value.data.map(parseWorkOrder),meta:{page:pn,perPage,total,lastPage}};
}
function historyResponse(value: unknown): WorkOrderEventDto[] {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new WorkOrderContractError();
  exact(value,['data']);
  return value.data.map(parseWorkOrderEvent);
}
function partResponse(value: unknown): WorkOrderPartResult {
  if (!isRecord(value) || !isRecord(value.meta)) throw new WorkOrderContractError();
  exact(value,['data','partUsage','meta']); exact(value.meta,['replayed']);
  if (typeof value.meta.replayed !== 'boolean') throw new WorkOrderContractError();
  return {workOrder:parseWorkOrder(value.data),partUsage:parseWorkOrderPartUsage(value.partUsage),replayed:value.meta.replayed};
}
export function workOrderIfMatch(version:number): string {
  if (!positiveInt(version)) throw new WorkOrderContractError('Versi Work Order tidak valid.');
  return `"${version}"`;
}
function path(id:string): string {
  if (!isUlid(id)) throw new WorkOrderContractError('ID Work Order tidak valid.');
  return `/work-orders/${encodeURIComponent(id)}`;
}
function reason(reason:string): {reason:string} {
  const normalized=reason.trim();
  if (normalized.length<3) throw new WorkOrderContractError('Alasan minimal 3 karakter.');
  return {reason:normalized};
}

export function createWorkOrderGateway(client: ApiClient): WorkOrderGateway {
  const mutate=(id:string,version:number,suffix:string,body:unknown={}) =>
    client.post<unknown>(`${path(id)}/${suffix}`,body,{ifMatch:workOrderIfMatch(version)}).then(response);
  return {
    async list(){ return page(await client.get<unknown>('/work-orders?perPage=200')); },
    async listAll(){
      const first=page(await client.get<unknown>('/work-orders?page=1&perPage=200'));
      if(first.meta.lastPage===1) return first.data;
      const pages=await Promise.all(Array.from({length:first.meta.lastPage-1},(_,i)=>client.get<unknown>(`/work-orders?page=${i+2}&perPage=200`)));
      return [...first.data,...pages.flatMap(p=>page(p).data)];
    },
    async show(id){ return response(await client.get<unknown>(path(id))); },
    async history(id){ return historyResponse(await client.get<unknown>(`${path(id)}/history`)); },
    async create(input){ return response(await client.post<unknown>('/work-orders',input)); },
    async update(id,version,input){ return response(await client.patch<unknown>(path(id),input,{ifMatch:workOrderIfMatch(version)})); },
    async assign(id,version,input){ return mutate(id,version,'assign',input); },
    async start(id,version){ return mutate(id,version,'start'); },
    async hold(id,version,r){ return mutate(id,version,'hold',reason(r)); },
    async waitingPart(id,version,r){ return mutate(id,version,'waiting-part',reason(r)); },
    async resume(id,version){ return mutate(id,version,'resume'); },
    async usePart(id,version,input){ return partResponse(await client.post<unknown>(`${path(id)}/parts`,input,{ifMatch:workOrderIfMatch(version)})); },
    async complete(id,version,input){ return mutate(id,version,'complete',input); },
    async verify(id,version){ return mutate(id,version,'verify'); },
    async rework(id,version,r){ return mutate(id,version,'rework',reason(r)); },
    async cancel(id,version,r){ return mutate(id,version,'cancel',reason(r)); },
  };
}

export const workOrderGateway=createWorkOrderGateway(apiClient);
