import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export const ASSET_CONDITIONS = ['good', 'minor_damage', 'moderate_damage', 'major_damage', 'unknown'] as const;
export const ASSET_LIFECYCLE_STATUSES = ['active', 'retired', 'disposed'] as const;

export type AssetCondition = (typeof ASSET_CONDITIONS)[number];
export type AssetLifecycleStatus = (typeof ASSET_LIFECYCLE_STATUSES)[number];

export interface AssetDto {
  id: string;
  schoolId: string;
  assetCode: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  homeLaboratoryId: string | null;
  condition: AssetCondition;
  lifecycleStatus: AssetLifecycleStatus;
  acquisitionDate: string | null;
  acquisitionYear: number | null;
  fundingSource: string | null;
  purchasePrice: number | null;
  supplierName: string | null;
  warrantyUntil: string | null;
  notes: string | null;
  linkedDeviceId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetPage {
  data: AssetDto[];
  meta: { page: number; perPage: number; total: number; lastPage: number };
}

export interface AssetListFilters {
  page?: number;
  perPage?: number;
  search?: string;
  homeLaboratoryId?: string;
  condition?: AssetCondition;
  lifecycleStatus?: AssetLifecycleStatus;
  linkedDeviceId?: string;
}

export interface CreateAssetInput {
  assetCode: string;
  name: string;
  category: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  homeLaboratoryId?: string | null;
  condition?: AssetCondition;
  acquisitionDate?: string | null;
  acquisitionYear?: number | null;
  fundingSource?: string | null;
  purchasePrice?: number | null;
  supplierName?: string | null;
  warrantyUntil?: string | null;
  notes?: string | null;
}

export type UpdateAssetInput = Omit<Partial<CreateAssetInput>, 'assetCode'>;

export interface AssetGateway {
  list: (filters?: AssetListFilters) => Promise<AssetPage>;
  listAll: (filters?: Omit<AssetListFilters, 'page' | 'perPage'>) => Promise<AssetDto[]>;
  show: (assetId: string) => Promise<AssetDto>;
  create: (input: CreateAssetInput) => Promise<AssetDto>;
  update: (assetId: string, expectedVersion: number, input: UpdateAssetInput) => Promise<AssetDto>;
  linkDevice: (assetId: string, expectedVersion: number, deviceId: string) => Promise<AssetDto>;
  unlinkDevice: (assetId: string, expectedVersion: number, reason: string) => Promise<AssetDto>;
  retire: (assetId: string, expectedVersion: number, reason: string) => Promise<AssetDto>;
  dispose: (assetId: string, expectedVersion: number, reason: string) => Promise<AssetDto>;
}

export class AssetContractError extends Error {
  constructor(message = 'Respons Asset tidak sesuai kontrak API.') {
    super(message);
    this.name = 'AssetContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], message?: string): void {
  const keys = Object.keys(record);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new AssetContractError(message);
  }
}

function requiredString(record: Record<string, unknown>, field: string, max = 255): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new AssetContractError();
  return value;
}

function nullableString(record: Record<string, unknown>, field: string, max = 5000): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw new AssetContractError();
  return value;
}

function requiredUlid(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (!isUlid(value)) throw new AssetContractError();
  return value;
}

function nullableUlid(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || !isUlid(value)) throw new AssetContractError();
  return value;
}

function nullableDate(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new AssetContractError();
  }
  return value;
}

function requiredDateTime(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (Number.isNaN(Date.parse(value))) throw new AssetContractError();
  return value;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

const ASSET_FIELDS = [
  'id', 'schoolId', 'assetCode', 'name', 'category', 'brand', 'model', 'serialNumber',
  'homeLaboratoryId', 'condition', 'lifecycleStatus', 'acquisitionDate', 'acquisitionYear',
  'fundingSource', 'purchasePrice', 'supplierName', 'warrantyUntil', 'notes',
  'linkedDeviceId', 'version', 'createdAt', 'updatedAt',
] as const;

export function parseAsset(value: unknown): AssetDto {
  if (!isRecord(value)) throw new AssetContractError();
  assertExactKeys(value, ASSET_FIELDS);

  if (typeof value.assetCode !== 'string' || !/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(value.assetCode)) throw new AssetContractError();
  if (!(ASSET_CONDITIONS as readonly unknown[]).includes(value.condition)) throw new AssetContractError();
  if (!(ASSET_LIFECYCLE_STATUSES as readonly unknown[]).includes(value.lifecycleStatus)) throw new AssetContractError();
  if (!positiveInteger(value.version)) throw new AssetContractError();

  const acquisitionYear = value.acquisitionYear;
  if (acquisitionYear !== null && (!Number.isSafeInteger(acquisitionYear) || (acquisitionYear as number) < 1900 || (acquisitionYear as number) > 2100)) {
    throw new AssetContractError();
  }
  const purchasePrice = value.purchasePrice;
  if (purchasePrice !== null && (typeof purchasePrice !== 'number' || !Number.isFinite(purchasePrice) || purchasePrice < 0)) {
    throw new AssetContractError();
  }

  return {
    id: requiredUlid(value, 'id'),
    schoolId: requiredUlid(value, 'schoolId'),
    assetCode: value.assetCode,
    name: requiredString(value, 'name'),
    category: requiredString(value, 'category', 120),
    brand: nullableString(value, 'brand', 255),
    model: nullableString(value, 'model', 255),
    serialNumber: nullableString(value, 'serialNumber', 255),
    homeLaboratoryId: nullableUlid(value, 'homeLaboratoryId'),
    condition: value.condition as AssetCondition,
    lifecycleStatus: value.lifecycleStatus as AssetLifecycleStatus,
    acquisitionDate: nullableDate(value, 'acquisitionDate'),
    acquisitionYear: acquisitionYear as number | null,
    fundingSource: nullableString(value, 'fundingSource', 255),
    purchasePrice: purchasePrice as number | null,
    supplierName: nullableString(value, 'supplierName', 255),
    warrantyUntil: nullableDate(value, 'warrantyUntil'),
    notes: nullableString(value, 'notes', 5000),
    linkedDeviceId: nullableUlid(value, 'linkedDeviceId'),
    version: value.version,
    createdAt: requiredDateTime(value, 'createdAt'),
    updatedAt: requiredDateTime(value, 'updatedAt'),
  };
}

export function parseAssetResponse(value: unknown): AssetDto {
  if (!isRecord(value)) throw new AssetContractError('Envelope Asset tidak valid.');
  assertExactKeys(value, ['data'], 'Envelope Asset tidak valid.');
  return parseAsset(value.data);
}

export function parseAssetCollectionResponse(value: unknown): AssetPage {
  if (!isRecord(value)) throw new AssetContractError('Envelope koleksi Asset tidak valid.');
  assertExactKeys(value, ['data', 'meta'], 'Envelope koleksi Asset tidak valid.');
  if (!Array.isArray(value.data) || !isRecord(value.meta)) throw new AssetContractError('Envelope koleksi Asset tidak valid.');
  assertExactKeys(value.meta, ['page', 'perPage', 'total', 'lastPage'], 'Metadata koleksi Asset tidak valid.');
  const { page, perPage, total, lastPage } = value.meta;
  if (!positiveInteger(page) || !positiveInteger(perPage) || perPage > 500 || !nonNegativeInteger(total) || !positiveInteger(lastPage)) {
    throw new AssetContractError('Metadata koleksi Asset tidak valid.');
  }
  return { data: value.data.map(parseAsset), meta: { page, perPage, total, lastPage } };
}

export function assetIfMatch(version: number): string {
  if (!positiveInteger(version)) throw new AssetContractError('Versi Asset tidak valid.');
  return `"${version}"`;
}

export function assetPath(assetId: string): string {
  if (assetId.trim() === '') throw new AssetContractError('ID Asset tidak valid.');
  return `/assets/${encodeURIComponent(assetId)}`;
}

export function buildAssetListPath(filters: AssetListFilters = {}): string {
  const parameters = new URLSearchParams();
  if (filters.page !== undefined) {
    if (!positiveInteger(filters.page)) throw new AssetContractError('Halaman Asset tidak valid.');
    parameters.set('page', String(filters.page));
  }
  if (filters.perPage !== undefined) {
    if (!positiveInteger(filters.perPage) || filters.perPage > 500) throw new AssetContractError('Ukuran halaman Asset tidak valid.');
    parameters.set('perPage', String(filters.perPage));
  }
  if (filters.search !== undefined) {
    const search = filters.search.trim();
    if (search.length === 0 || search.length > 255) throw new AssetContractError('Pencarian Asset tidak valid.');
    parameters.set('search', search);
  }
  if (filters.homeLaboratoryId !== undefined) {
    if (filters.homeLaboratoryId.trim() === '') throw new AssetContractError('Filter Laboratory tidak valid.');
    parameters.set('homeLaboratoryId', filters.homeLaboratoryId);
  }
  if (filters.condition !== undefined) parameters.set('condition', filters.condition);
  if (filters.lifecycleStatus !== undefined) parameters.set('lifecycleStatus', filters.lifecycleStatus);
  if (filters.linkedDeviceId !== undefined) {
    if (filters.linkedDeviceId.trim() === '') throw new AssetContractError('Filter Device tidak valid.');
    parameters.set('linkedDeviceId', filters.linkedDeviceId);
  }
  const query = parameters.toString();
  return query === '' ? '/assets' : `/assets?${query}`;
}

function createPayload(input: CreateAssetInput): CreateAssetInput {
  const payload: CreateAssetInput = {
    assetCode: input.assetCode,
    name: input.name,
    category: input.category,
  };
  for (const field of [
    'brand', 'model', 'serialNumber', 'homeLaboratoryId', 'condition', 'acquisitionDate',
    'acquisitionYear', 'fundingSource', 'purchasePrice', 'supplierName', 'warrantyUntil', 'notes',
  ] as const) {
    if (input[field] !== undefined) Object.assign(payload, { [field]: input[field] });
  }
  return payload;
}

function updatePayload(input: UpdateAssetInput): UpdateAssetInput {
  const payload: UpdateAssetInput = {};
  for (const field of [
    'name', 'category', 'brand', 'model', 'serialNumber', 'homeLaboratoryId', 'condition',
    'acquisitionDate', 'acquisitionYear', 'fundingSource', 'purchasePrice', 'supplierName',
    'warrantyUntil', 'notes',
  ] as const) {
    if (input[field] !== undefined) Object.assign(payload, { [field]: input[field] });
  }
  if (Object.keys(payload).length === 0) throw new AssetContractError('Tidak ada field Asset yang dapat diperbarui.');
  return payload;
}

export function createAssetGateway(client: ApiClient): AssetGateway {
  return {
    async list(filters = {}) {
      return parseAssetCollectionResponse(await client.get<unknown>(buildAssetListPath(filters)));
    },
    async listAll(filters = {}) {
      const first = parseAssetCollectionResponse(await client.get<unknown>(buildAssetListPath({ ...filters, page: 1, perPage: 500 })));
      if (first.meta.lastPage === 1) return first.data;
      const pages = await Promise.all(
        Array.from({ length: first.meta.lastPage - 1 }, (_, index) =>
          client.get<unknown>(buildAssetListPath({ ...filters, page: index + 2, perPage: 500 }))),
      );
      return [...first.data, ...pages.flatMap((page) => parseAssetCollectionResponse(page).data)];
    },
    async show(assetId) {
      return parseAssetResponse(await client.get<unknown>(assetPath(assetId)));
    },
    async create(input) {
      return parseAssetResponse(await client.post<unknown>('/assets', createPayload(input)));
    },
    async update(assetId, expectedVersion, input) {
      return parseAssetResponse(await client.patch<unknown>(
        assetPath(assetId),
        updatePayload(input),
        { ifMatch: assetIfMatch(expectedVersion) },
      ));
    },
    async linkDevice(assetId, expectedVersion, deviceId) {
      return parseAssetResponse(await client.post<unknown>(
        `${assetPath(assetId)}/device-link`,
        { deviceId },
        { ifMatch: assetIfMatch(expectedVersion) },
      ));
    },
    async unlinkDevice(assetId, expectedVersion, reason) {
      return parseAssetResponse(await client.post<unknown>(
        `${assetPath(assetId)}/device-unlink`,
        { reason },
        { ifMatch: assetIfMatch(expectedVersion) },
      ));
    },
    async retire(assetId, expectedVersion, reason) {
      return parseAssetResponse(await client.post<unknown>(
        `${assetPath(assetId)}/retire`,
        { reason },
        { ifMatch: assetIfMatch(expectedVersion) },
      ));
    },
    async dispose(assetId, expectedVersion, reason) {
      return parseAssetResponse(await client.post<unknown>(
        `${assetPath(assetId)}/dispose`,
        { reason },
        { ifMatch: assetIfMatch(expectedVersion) },
      ));
    },
  };
}

export const assetGateway = createAssetGateway(apiClient);
