import { deviceIfMatch } from '@/services/deviceApi';
import { ApiClientError, apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export interface DeviceTransferLaboratorySnapshot {
  id: string;
  code: string;
  name: string;
}

export interface DeviceTransferActorSnapshot {
  id: string;
  name: string;
}

export interface DeviceTransferDto {
  id: string;
  deviceId: string;
  deviceCode: string;
  sourceLaboratory: DeviceTransferLaboratorySnapshot;
  destinationLaboratory: DeviceTransferLaboratorySnapshot;
  reason: string | null;
  actor: DeviceTransferActorSnapshot;
  deviceVersionBefore: number;
  deviceVersionAfter: number;
  createdAt: string;
}

export interface DeviceTransferPage {
  data: DeviceTransferDto[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    lastPage: number;
  };
}

export interface CreateDeviceTransferInput {
  destinationLaboratoryId: string;
  reason?: string | null;
}

export interface DeviceTransferHistoryFilters {
  page?: number;
  perPage?: number;
}

export interface DeviceTransferGateway {
  create: (deviceId: string, expectedVersion: number, input: CreateDeviceTransferInput) => Promise<DeviceTransferDto>;
  history: (deviceId: string, filters?: DeviceTransferHistoryFilters) => Promise<DeviceTransferPage>;
}

export class DeviceTransferContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceTransferContractError';
  }
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: RecordValue, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function dateTime(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function positiveVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function parseLaboratorySnapshot(value: unknown): DeviceTransferLaboratorySnapshot {
  if (!isRecord(value) || !exactKeys(value, ['id', 'code', 'name']) || !isUlid(value.id)
    || !boundedString(value.code, 50) || !boundedString(value.name, 255)) {
    throw new DeviceTransferContractError('Snapshot Laboratory Transfer tidak valid.');
  }
  return { id: value.id, code: value.code, name: value.name };
}

function parseActorSnapshot(value: unknown): DeviceTransferActorSnapshot {
  if (!isRecord(value) || !exactKeys(value, ['id', 'name']) || !isUlid(value.id) || !boundedString(value.name, 255)) {
    throw new DeviceTransferContractError('Snapshot aktor Transfer tidak valid.');
  }
  return { id: value.id, name: value.name };
}

export function parseDeviceTransfer(value: unknown): DeviceTransferDto {
  if (!isRecord(value) || !exactKeys(value, [
    'id', 'deviceId', 'deviceCode', 'sourceLaboratory', 'destinationLaboratory', 'reason', 'actor',
    'deviceVersionBefore', 'deviceVersionAfter', 'createdAt',
  ])) {
    throw new DeviceTransferContractError('DTO Transfer tidak sesuai kontrak.');
  }
  if (!isUlid(value.id) || !isUlid(value.deviceId) || typeof value.deviceCode !== 'string'
    || !/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(value.deviceCode)
    || (value.reason !== null && (!boundedString(value.reason, 500) || value.reason.trim() === ''))
    || !positiveVersion(value.deviceVersionBefore) || !positiveVersion(value.deviceVersionAfter)
    || value.deviceVersionAfter !== value.deviceVersionBefore + 1 || !dateTime(value.createdAt)) {
    throw new DeviceTransferContractError('DTO Transfer tidak sesuai kontrak.');
  }
  return {
    id: value.id,
    deviceId: value.deviceId,
    deviceCode: value.deviceCode,
    sourceLaboratory: parseLaboratorySnapshot(value.sourceLaboratory),
    destinationLaboratory: parseLaboratorySnapshot(value.destinationLaboratory),
    reason: value.reason,
    actor: parseActorSnapshot(value.actor),
    deviceVersionBefore: value.deviceVersionBefore,
    deviceVersionAfter: value.deviceVersionAfter,
    createdAt: value.createdAt,
  };
}

export function parseDeviceTransferResponse(value: unknown): DeviceTransferDto {
  if (!isRecord(value) || !exactKeys(value, ['data'])) throw new DeviceTransferContractError('Envelope Transfer tidak valid.');
  return parseDeviceTransfer(value.data);
}

export function parseDeviceTransferCollectionResponse(value: unknown): DeviceTransferPage {
  if (!isRecord(value) || !exactKeys(value, ['data', 'meta']) || !Array.isArray(value.data) || !isRecord(value.meta)
    || !exactKeys(value.meta, ['page', 'perPage', 'total', 'lastPage'])) {
    throw new DeviceTransferContractError('Collection Transfer tidak valid.');
  }
  const { page, perPage, total, lastPage } = value.meta;
  if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1
    || typeof perPage !== 'number' || !Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100
    || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0
    || typeof lastPage !== 'number' || !Number.isSafeInteger(lastPage) || lastPage < 1) {
    throw new DeviceTransferContractError('Metadata collection Transfer tidak valid.');
  }
  if (page > lastPage || (total === 0 && lastPage !== 1)) throw new DeviceTransferContractError('Metadata collection Transfer tidak valid.');
  return {
    data: value.data.map(parseDeviceTransfer),
    meta: { page, perPage, total, lastPage },
  };
}

function transferPath(deviceId: string): string {
  const normalized = deviceId.trim();
  if (!normalized) throw new DeviceTransferContractError('ID Device wajib diisi.');
  return `/devices/${encodeURIComponent(normalized)}/transfers`;
}

function normalizeReason(reason: string | null | undefined): string | null | undefined {
  if (reason === undefined || reason === null) return reason;
  const normalized = reason.trim();
  return normalized === '' ? null : normalized;
}

function pagination(filters?: DeviceTransferHistoryFilters): string {
  const page = filters?.page ?? 1;
  const perPage = filters?.perPage ?? 10;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) {
    throw new DeviceTransferContractError('Parameter pagination Transfer tidak valid.');
  }
  return `?page=${page}&perPage=${perPage}`;
}

export function createDeviceTransferGateway(client: ApiClient): DeviceTransferGateway {
  return {
    async create(deviceId, expectedVersion, input) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !isUlid(deviceId)) {
        throw new DeviceTransferContractError('Precondition Transfer tidak valid.');
      }
      if (!isUlid(input.destinationLaboratoryId)) throw new DeviceTransferContractError('Laboratorium tujuan tidak valid.');
      const reason = normalizeReason(input.reason);
      if (typeof reason === 'string' && reason.length > 500) throw new DeviceTransferContractError('Alasan Transfer maksimal 500 karakter.');
      const body: Record<string, unknown> = { destinationLaboratoryId: input.destinationLaboratoryId };
      if (reason !== undefined) body.reason = reason;
      const response = await client.post<unknown>(transferPath(deviceId), body, { ifMatch: deviceIfMatch(expectedVersion) });
      return parseDeviceTransferResponse(response);
    },
    async history(deviceId, filters) {
      if (!isUlid(deviceId)) throw new DeviceTransferContractError('ID Device tidak valid.');
      const response = await client.get<unknown>(`${transferPath(deviceId)}${pagination(filters)}`);
      return parseDeviceTransferCollectionResponse(response);
    },
  };
}

export const deviceTransferGateway = createDeviceTransferGateway(apiClient);

export function isTransferNetworkAmbiguity(error: unknown): boolean {
  return error instanceof ApiClientError && (error.kind === 'network' || (error.status !== undefined && error.status >= 500));
}
