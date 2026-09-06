import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export const INVENTORY_TRANSACTION_KINDS = ['opening', 'receipt', 'issue', 'adjustment_in', 'adjustment_out'] as const;
export type InventoryTransactionKind = (typeof INVENTORY_TRANSACTION_KINDS)[number];

export interface InventoryItemDto {
  id: string;
  schoolId: string;
  itemCode: string;
  name: string;
  category: string;
  unit: string;
  minimumStock: number;
  storageLocation: string | null;
  supplierName: string | null;
  unitPriceSnapshot: number | null;
  onHandQuantity: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryTransactionDto {
  id: string;
  schoolId: string;
  inventoryItemId: string;
  clientMutationId: string;
  kind: InventoryTransactionKind;
  quantity: number;
  signedDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  itemVersionAfter: number;
  reason: string;
  sourceType: string | null;
  sourceId: string | null;
  actorUserIdSnapshot: string;
  actorMembershipIdSnapshot: string;
  actorNameSnapshot: string;
  itemCodeSnapshot: string;
  itemNameSnapshot: string;
  unitSnapshot: string;
  occurredAt: string;
  createdAt: string;
}

export interface InventoryPage<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; lastPage: number };
}

export interface InventoryItemFilters {
  page?: number;
  perPage?: number;
  search?: string;
  category?: string;
  lowStock?: boolean;
}

export interface InventoryTransactionFilters {
  page?: number;
  perPage?: number;
  inventoryItemId?: string;
  kind?: InventoryTransactionKind;
  from?: string;
  to?: string;
}

export interface CreateInventoryItemInput {
  itemCode: string;
  name: string;
  category: string;
  unit: string;
  minimumStock?: number;
  storageLocation?: string | null;
  supplierName?: string | null;
  unitPriceSnapshot?: number | null;
}

export type UpdateInventoryItemInput = Omit<Partial<CreateInventoryItemInput>, 'itemCode'>;

export interface CreateInventoryTransactionInput {
  inventoryItemId: string;
  clientMutationId: string;
  kind: InventoryTransactionKind;
  quantity: number;
  reason: string;
}

export interface InventoryTransactionResult {
  transaction: InventoryTransactionDto;
  replayed: boolean;
}

export interface InventoryGateway {
  listItems: (filters?: InventoryItemFilters) => Promise<InventoryPage<InventoryItemDto>>;
  listAllItems: () => Promise<InventoryItemDto[]>;
  showItem: (itemId: string) => Promise<InventoryItemDto>;
  createItem: (input: CreateInventoryItemInput) => Promise<InventoryItemDto>;
  updateItem: (itemId: string, expectedVersion: number, input: UpdateInventoryItemInput) => Promise<InventoryItemDto>;
  listTransactions: (filters?: InventoryTransactionFilters) => Promise<InventoryPage<InventoryTransactionDto>>;
  listAllTransactions: () => Promise<InventoryTransactionDto[]>;
  transact: (input: CreateInventoryTransactionInput) => Promise<InventoryTransactionResult>;
}

export class InventoryContractError extends Error {
  constructor(message = 'Respons Inventory tidak sesuai kontrak API.') {
    super(message);
    this.name = 'InventoryContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], message?: string): void {
  const keys = Object.keys(record);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new InventoryContractError(message);
  }
}

function requiredString(record: Record<string, unknown>, field: string, max = 1000): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new InventoryContractError();
  return value;
}

function nullableString(record: Record<string, unknown>, field: string, max = 255): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw new InventoryContractError();
  return value;
}

function requiredUlid(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (!isUlid(value)) throw new InventoryContractError();
  return value;
}

function nullableUlid(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || !isUlid(value)) throw new InventoryContractError();
  return value;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requiredDateTime(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (Number.isNaN(Date.parse(value))) throw new InventoryContractError();
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const ITEM_FIELDS = [
  'id', 'schoolId', 'itemCode', 'name', 'category', 'unit', 'minimumStock',
  'storageLocation', 'supplierName', 'unitPriceSnapshot', 'onHandQuantity',
  'version', 'createdAt', 'updatedAt',
] as const;

export function parseInventoryItem(value: unknown): InventoryItemDto {
  if (!isRecord(value)) throw new InventoryContractError();
  assertExactKeys(value, ITEM_FIELDS);
  if (typeof value.itemCode !== 'string' || !/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(value.itemCode)) throw new InventoryContractError();
  if (!finiteNonNegative(value.minimumStock) || !finiteNonNegative(value.onHandQuantity)) throw new InventoryContractError();
  if (value.unitPriceSnapshot !== null && !finiteNonNegative(value.unitPriceSnapshot)) throw new InventoryContractError();
  if (!positiveInteger(value.version)) throw new InventoryContractError();

  return {
    id: requiredUlid(value, 'id'),
    schoolId: requiredUlid(value, 'schoolId'),
    itemCode: value.itemCode,
    name: requiredString(value, 'name', 255),
    category: requiredString(value, 'category', 120),
    unit: requiredString(value, 'unit', 32),
    minimumStock: value.minimumStock,
    storageLocation: nullableString(value, 'storageLocation'),
    supplierName: nullableString(value, 'supplierName'),
    unitPriceSnapshot: value.unitPriceSnapshot as number | null,
    onHandQuantity: value.onHandQuantity,
    version: value.version,
    createdAt: requiredDateTime(value, 'createdAt'),
    updatedAt: requiredDateTime(value, 'updatedAt'),
  };
}

const TRANSACTION_FIELDS = [
  'id', 'schoolId', 'inventoryItemId', 'clientMutationId', 'kind', 'quantity',
  'signedDelta', 'balanceBefore', 'balanceAfter', 'itemVersionAfter', 'reason',
  'sourceType', 'sourceId', 'actorUserIdSnapshot', 'actorMembershipIdSnapshot',
  'actorNameSnapshot', 'itemCodeSnapshot', 'itemNameSnapshot', 'unitSnapshot',
  'occurredAt', 'createdAt',
] as const;

export function parseInventoryTransaction(value: unknown): InventoryTransactionDto {
  if (!isRecord(value)) throw new InventoryContractError();
  assertExactKeys(value, TRANSACTION_FIELDS);
  if (!isUuid(value.clientMutationId)) throw new InventoryContractError();
  if (!(INVENTORY_TRANSACTION_KINDS as readonly unknown[]).includes(value.kind)) throw new InventoryContractError();
  if (typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity <= 0) throw new InventoryContractError();
  if (typeof value.signedDelta !== 'number' || !Number.isFinite(value.signedDelta) || value.signedDelta === 0) throw new InventoryContractError();
  if (!finiteNonNegative(value.balanceBefore) || !finiteNonNegative(value.balanceAfter)) throw new InventoryContractError();
  if (!positiveInteger(value.itemVersionAfter)) throw new InventoryContractError();
  if (round3(Math.abs(value.signedDelta)) !== round3(value.quantity)) throw new InventoryContractError();
  if (round3(value.balanceBefore + value.signedDelta) !== round3(value.balanceAfter)) throw new InventoryContractError();

  return {
    id: requiredUlid(value, 'id'),
    schoolId: requiredUlid(value, 'schoolId'),
    inventoryItemId: requiredUlid(value, 'inventoryItemId'),
    clientMutationId: value.clientMutationId,
    kind: value.kind as InventoryTransactionKind,
    quantity: value.quantity,
    signedDelta: value.signedDelta,
    balanceBefore: value.balanceBefore,
    balanceAfter: value.balanceAfter,
    itemVersionAfter: value.itemVersionAfter,
    reason: requiredString(value, 'reason', 1000),
    sourceType: nullableString(value, 'sourceType', 64),
    sourceId: nullableUlid(value, 'sourceId'),
    actorUserIdSnapshot: requiredUlid(value, 'actorUserIdSnapshot'),
    actorMembershipIdSnapshot: requiredUlid(value, 'actorMembershipIdSnapshot'),
    actorNameSnapshot: requiredString(value, 'actorNameSnapshot', 255),
    itemCodeSnapshot: requiredString(value, 'itemCodeSnapshot', 32),
    itemNameSnapshot: requiredString(value, 'itemNameSnapshot', 255),
    unitSnapshot: requiredString(value, 'unitSnapshot', 32),
    occurredAt: requiredDateTime(value, 'occurredAt'),
    createdAt: requiredDateTime(value, 'createdAt'),
  };
}

function parsePage<T>(value: unknown, parser: (item: unknown) => T): InventoryPage<T> {
  if (!isRecord(value)) throw new InventoryContractError('Envelope koleksi Inventory tidak valid.');
  assertExactKeys(value, ['data', 'meta'], 'Envelope koleksi Inventory tidak valid.');
  if (!Array.isArray(value.data) || !isRecord(value.meta)) throw new InventoryContractError('Envelope koleksi Inventory tidak valid.');
  assertExactKeys(value.meta, ['page', 'perPage', 'total', 'lastPage'], 'Metadata koleksi Inventory tidak valid.');
  const { page, perPage, total, lastPage } = value.meta;
  if (!positiveInteger(page) || !positiveInteger(perPage) || perPage > 500 || !nonNegativeInteger(total) || !positiveInteger(lastPage)) {
    throw new InventoryContractError('Metadata koleksi Inventory tidak valid.');
  }
  return { data: value.data.map(parser), meta: { page, perPage, total, lastPage } };
}

function parseItemResponse(value: unknown): InventoryItemDto {
  if (!isRecord(value)) throw new InventoryContractError('Envelope InventoryItem tidak valid.');
  assertExactKeys(value, ['data'], 'Envelope InventoryItem tidak valid.');
  return parseInventoryItem(value.data);
}

function parseTransactionResult(value: unknown): InventoryTransactionResult {
  if (!isRecord(value)) throw new InventoryContractError('Envelope transaksi stok tidak valid.');
  assertExactKeys(value, ['data', 'meta'], 'Envelope transaksi stok tidak valid.');
  if (!isRecord(value.meta)) throw new InventoryContractError('Metadata transaksi stok tidak valid.');
  assertExactKeys(value.meta, ['replayed'], 'Metadata transaksi stok tidak valid.');
  if (typeof value.meta.replayed !== 'boolean') throw new InventoryContractError('Metadata transaksi stok tidak valid.');
  return { transaction: parseInventoryTransaction(value.data), replayed: value.meta.replayed };
}

export function inventoryItemIfMatch(version: number): string {
  if (!positiveInteger(version)) throw new InventoryContractError('Versi InventoryItem tidak valid.');
  return `"${version}"`;
}

export function inventoryItemPath(itemId: string): string {
  if (itemId.trim() === '') throw new InventoryContractError('ID InventoryItem tidak valid.');
  return `/stock-items/${encodeURIComponent(itemId)}`;
}

export function buildInventoryItemListPath(filters: InventoryItemFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.perPage !== undefined) params.set('perPage', String(filters.perPage));
  if (filters.search !== undefined) params.set('search', filters.search.trim());
  if (filters.category !== undefined) params.set('category', filters.category);
  if (filters.lowStock !== undefined) params.set('lowStock', filters.lowStock ? '1' : '0');
  const query = params.toString();
  return query ? `/stock-items?${query}` : '/stock-items';
}

export function buildInventoryTransactionListPath(filters: InventoryTransactionFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.perPage !== undefined) params.set('perPage', String(filters.perPage));
  if (filters.inventoryItemId !== undefined) params.set('inventoryItemId', filters.inventoryItemId);
  if (filters.kind !== undefined) params.set('kind', filters.kind);
  if (filters.from !== undefined) params.set('from', filters.from);
  if (filters.to !== undefined) params.set('to', filters.to);
  const query = params.toString();
  return query ? `/stock-transactions?${query}` : '/stock-transactions';
}

export function createInventoryGateway(client: ApiClient): InventoryGateway {
  return {
    async listItems(filters = {}) {
      return parsePage(await client.get<unknown>(buildInventoryItemListPath(filters)), parseInventoryItem);
    },
    async listAllItems() {
      const first = parsePage(await client.get<unknown>(buildInventoryItemListPath({ page: 1, perPage: 500 })), parseInventoryItem);
      if (first.meta.lastPage === 1) return first.data;
      const pages = await Promise.all(Array.from({ length: first.meta.lastPage - 1 }, (_, index) =>
        client.get<unknown>(buildInventoryItemListPath({ page: index + 2, perPage: 500 }))));
      return [...first.data, ...pages.flatMap((page) => parsePage(page, parseInventoryItem).data)];
    },
    async showItem(itemId) {
      return parseItemResponse(await client.get<unknown>(inventoryItemPath(itemId)));
    },
    async createItem(input) {
      const payload = {
        itemCode: input.itemCode,
        name: input.name,
        category: input.category,
        unit: input.unit,
        ...(input.minimumStock !== undefined ? { minimumStock: input.minimumStock } : {}),
        ...(input.storageLocation !== undefined ? { storageLocation: input.storageLocation } : {}),
        ...(input.supplierName !== undefined ? { supplierName: input.supplierName } : {}),
        ...(input.unitPriceSnapshot !== undefined ? { unitPriceSnapshot: input.unitPriceSnapshot } : {}),
      };
      return parseItemResponse(await client.post<unknown>('/stock-items', payload));
    },
    async updateItem(itemId, expectedVersion, input) {
      const payload: Record<string, unknown> = {};
      for (const field of ['name', 'category', 'unit', 'minimumStock', 'storageLocation', 'supplierName', 'unitPriceSnapshot'] as const) {
        if (input[field] !== undefined) payload[field] = input[field];
      }
      if (Object.keys(payload).length === 0) throw new InventoryContractError('Tidak ada metadata InventoryItem yang dapat diperbarui.');
      return parseItemResponse(await client.patch<unknown>(inventoryItemPath(itemId), payload, { ifMatch: inventoryItemIfMatch(expectedVersion) }));
    },
    async listTransactions(filters = {}) {
      return parsePage(await client.get<unknown>(buildInventoryTransactionListPath(filters)), parseInventoryTransaction);
    },
    async listAllTransactions() {
      const first = parsePage(await client.get<unknown>(buildInventoryTransactionListPath({ page: 1, perPage: 500 })), parseInventoryTransaction);
      if (first.meta.lastPage === 1) return first.data;
      const pages = await Promise.all(Array.from({ length: first.meta.lastPage - 1 }, (_, index) =>
        client.get<unknown>(buildInventoryTransactionListPath({ page: index + 2, perPage: 500 }))));
      return [...first.data, ...pages.flatMap((page) => parsePage(page, parseInventoryTransaction).data)];
    },
    async transact(input) {
      return parseTransactionResult(await client.post<unknown>('/stock-transactions', {
        inventoryItemId: input.inventoryItemId,
        clientMutationId: input.clientMutationId,
        kind: input.kind,
        quantity: input.quantity,
        reason: input.reason,
      }));
    },
  };
}

export const inventoryGateway = createInventoryGateway(apiClient);
