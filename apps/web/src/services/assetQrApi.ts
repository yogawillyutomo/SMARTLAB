import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';
import {
  ASSET_CONDITIONS,
  ASSET_LIFECYCLE_STATUSES,
  type AssetCondition,
  type AssetLifecycleStatus,
} from '@/services/assetApi';

export const ASSET_QR_LABEL_TEMPLATES = ['40x25', '50x30', '70x40'] as const;
export type AssetQrLabelTemplate = (typeof ASSET_QR_LABEL_TEMPLATES)[number];
export type AssetQrLinkStatus = 'linked' | 'unlinked';
export type AssetQrStatus = 'active' | 'missing';
export type AssetQrPrintedStatus = 'printed' | 'unprinted';

export interface AssetQrLaboratorySnapshot {
  id: string;
  code: string;
  name: string;
}

export interface AssetQrLabelSelection {
  laboratoryId?: string | null;
  category?: string;
  condition?: AssetCondition;
  lifecycleStatus?: AssetLifecycleStatus;
  linkStatus?: AssetQrLinkStatus;
  qrStatus?: AssetQrStatus;
  printedStatus?: AssetQrPrintedStatus;
  search?: string;
}

export interface AssetQrLabelCandidate extends Omit<Required<Pick<AssetQrLabelSelection, never>>, never> {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  condition: AssetCondition;
  lifecycleStatus: AssetLifecycleStatus;
  linked: boolean;
  laboratory: AssetQrLaboratorySnapshot | null;
  qr: {
    status: AssetQrStatus;
    tokenVersion: number | null;
    printed: boolean;
  };
}

export interface AssetQrPageMeta {
  page: number;
  perPage: number;
  total: number;
  lastPage: number;
}

export interface AssetQrLabelCandidatePage {
  data: AssetQrLabelCandidate[];
  meta: AssetQrPageMeta;
}

export interface AssetQrLabelCandidateFilters extends AssetQrLabelSelection {
  page?: number;
  perPage?: number;
}

export interface AssetQrLabelBatchItem {
  ordinal: number;
  assetId: string;
  assetCode: string;
  assetName: string;
  laboratory: AssetQrLaboratorySnapshot | null;
  publicId: string;
  tokenVersion: number;
  scanPath: string;
}

export interface AssetQrLabelBatchEvent {
  type: 'generated' | 'reprinted';
  actorName: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AssetQrLabelBatch {
  id: string;
  templateKey: AssetQrLabelTemplate;
  filters: AssetQrLabelSelection;
  assetCount: number;
  laboratory: AssetQrLaboratorySnapshot | null;
  generatedByName: string;
  generatedAt: string;
  items?: AssetQrLabelBatchItem[];
  events?: AssetQrLabelBatchEvent[];
}

export interface AssetQrLabelBatchPage {
  data: AssetQrLabelBatch[];
  meta: AssetQrPageMeta;
}

export interface CreateAssetQrLabelBatchInput {
  templateKey: AssetQrLabelTemplate;
  assetIds: string[];
  selection?: AssetQrLabelSelection;
}

export interface AssetQrIdentity {
  id: string;
  assetId: string;
  publicId: string;
  tokenVersion: number;
  status: 'active' | 'revoked';
  issuedAt: string;
  revokedReason: string | null;
  revokedAt: string | null;
}

export interface AssetQrGateway {
  candidates: (filters?: AssetQrLabelCandidateFilters) => Promise<AssetQrLabelCandidatePage>;
  listBatches: (filters?: { laboratoryId?: string; page?: number; perPage?: number }) => Promise<AssetQrLabelBatchPage>;
  generateBatch: (input: CreateAssetQrLabelBatchInput) => Promise<AssetQrLabelBatch>;
  showBatch: (batchId: string) => Promise<AssetQrLabelBatch>;
  reprintBatch: (batchId: string, reason: string) => Promise<AssetQrLabelBatch>;
  history: (assetId: string) => Promise<AssetQrIdentity[]>;
  issue: (assetId: string) => Promise<AssetQrIdentity>;
  rotate: (assetId: string, tokenVersion: number, reason: string) => Promise<AssetQrIdentity>;
  revoke: (assetId: string, tokenVersion: number, reason: string) => Promise<AssetQrIdentity>;
}

export class AssetQrContractError extends Error {
  constructor(message = 'Respons Asset QR tidak sesuai kontrak API.') {
    super(message);
    this.name = 'AssetQrContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): void {
  const keys = Object.keys(record);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
    throw new AssetQrContractError();
  }
}

function requiredString(record: Record<string, unknown>, field: string, max = 5000): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new AssetQrContractError();
  return value;
}

function requiredUlid(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field, 64);
  if (!isUlid(value)) throw new AssetQrContractError();
  return value;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requiredDateTime(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field, 128);
  if (Number.isNaN(Date.parse(value))) throw new AssetQrContractError();
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseLaboratory(value: unknown): AssetQrLaboratorySnapshot | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new AssetQrContractError();
  assertOnlyKeys(value, ['id', 'code', 'name']);
  return {
    id: requiredUlid(value, 'id'),
    code: requiredString(value, 'code', 100),
    name: requiredString(value, 'name', 255),
  };
}

function parseMeta(value: unknown, maxPerPage: number): AssetQrPageMeta {
  if (!isRecord(value)) throw new AssetQrContractError('Metadata Asset QR tidak valid.');
  assertOnlyKeys(value, ['page', 'perPage', 'total', 'lastPage']);
  if (!positiveInteger(value.page) || !positiveInteger(value.perPage) || value.perPage > maxPerPage
    || !nonNegativeInteger(value.total) || !positiveInteger(value.lastPage)) {
    throw new AssetQrContractError('Metadata Asset QR tidak valid.');
  }
  return {
    page: value.page,
    perPage: value.perPage,
    total: value.total,
    lastPage: value.lastPage,
  };
}

const SELECTION_FIELDS = [
  'laboratoryId', 'category', 'condition', 'lifecycleStatus',
  'linkStatus', 'qrStatus', 'printedStatus', 'search',
] as const;

export function parseAssetQrLabelSelection(value: unknown): AssetQrLabelSelection {
  if (!isRecord(value)) throw new AssetQrContractError('Snapshot filter label tidak valid.');
  assertOnlyKeys(value, SELECTION_FIELDS, []);
  const result: AssetQrLabelSelection = {};
  if ('laboratoryId' in value) {
    if (value.laboratoryId === null) result.laboratoryId = null;
    else if (typeof value.laboratoryId === 'string' && isUlid(value.laboratoryId)) result.laboratoryId = value.laboratoryId;
    else throw new AssetQrContractError('Snapshot Laboratory tidak valid.');
  }
  if ('category' in value) result.category = requiredString(value, 'category', 100);
  if ('condition' in value) {
    if (!(ASSET_CONDITIONS as readonly unknown[]).includes(value.condition)) throw new AssetQrContractError();
    result.condition = value.condition as AssetCondition;
  }
  if ('lifecycleStatus' in value) {
    if (!(ASSET_LIFECYCLE_STATUSES as readonly unknown[]).includes(value.lifecycleStatus)) throw new AssetQrContractError();
    result.lifecycleStatus = value.lifecycleStatus as AssetLifecycleStatus;
  }
  if ('linkStatus' in value) {
    if (!['linked', 'unlinked'].includes(String(value.linkStatus))) throw new AssetQrContractError();
    result.linkStatus = value.linkStatus as AssetQrLinkStatus;
  }
  if ('qrStatus' in value) {
    if (!['active', 'missing'].includes(String(value.qrStatus))) throw new AssetQrContractError();
    result.qrStatus = value.qrStatus as AssetQrStatus;
  }
  if ('printedStatus' in value) {
    if (!['printed', 'unprinted'].includes(String(value.printedStatus))) throw new AssetQrContractError();
    result.printedStatus = value.printedStatus as AssetQrPrintedStatus;
  }
  if ('search' in value) result.search = requiredString(value, 'search', 255);
  return result;
}

export function parseAssetQrLabelCandidate(value: unknown): AssetQrLabelCandidate {
  if (!isRecord(value)) throw new AssetQrContractError();
  assertOnlyKeys(value, ['id', 'assetCode', 'name', 'category', 'condition', 'lifecycleStatus', 'linked', 'laboratory', 'qr']);
  if (!(ASSET_CONDITIONS as readonly unknown[]).includes(value.condition)) throw new AssetQrContractError();
  if (!(ASSET_LIFECYCLE_STATUSES as readonly unknown[]).includes(value.lifecycleStatus)) throw new AssetQrContractError();
  if (typeof value.linked !== 'boolean' || !isRecord(value.qr)) throw new AssetQrContractError();
  assertOnlyKeys(value.qr, ['status', 'tokenVersion', 'printed']);
  if (!['active', 'missing'].includes(String(value.qr.status)) || typeof value.qr.printed !== 'boolean') throw new AssetQrContractError();
  const tokenVersion = value.qr.tokenVersion;
  if (tokenVersion !== null && !positiveInteger(tokenVersion)) throw new AssetQrContractError();
  if (value.qr.status === 'missing' && tokenVersion !== null) throw new AssetQrContractError();
  if (value.qr.status === 'active' && !positiveInteger(tokenVersion)) throw new AssetQrContractError();
  return {
    id: requiredUlid(value, 'id'),
    assetCode: requiredString(value, 'assetCode', 64),
    name: requiredString(value, 'name', 255),
    category: requiredString(value, 'category', 120),
    condition: value.condition as AssetCondition,
    lifecycleStatus: value.lifecycleStatus as AssetLifecycleStatus,
    linked: value.linked,
    laboratory: parseLaboratory(value.laboratory),
    qr: {
      status: value.qr.status as AssetQrStatus,
      tokenVersion: tokenVersion as number | null,
      printed: value.qr.printed,
    },
  };
}

function parseCandidatePage(value: unknown): AssetQrLabelCandidatePage {
  if (!isRecord(value)) throw new AssetQrContractError();
  assertOnlyKeys(value, ['data', 'meta']);
  if (!Array.isArray(value.data)) throw new AssetQrContractError();
  return { data: value.data.map(parseAssetQrLabelCandidate), meta: parseMeta(value.meta, 500) };
}

function parseBatchItem(value: unknown): AssetQrLabelBatchItem {
  if (!isRecord(value)) throw new AssetQrContractError();
  assertOnlyKeys(value, ['ordinal', 'assetId', 'assetCode', 'assetName', 'laboratory', 'publicId', 'tokenVersion', 'scanPath']);
  if (!positiveInteger(value.ordinal) || !positiveInteger(value.tokenVersion) || !isUuid(value.publicId)) throw new AssetQrContractError();
  const scanPath = requiredString(value, 'scanPath', 255);
  if (scanPath !== `/api/v1/public/assets/qr/${value.publicId}`) throw new AssetQrContractError('Path scan label tidak valid.');
  return {
    ordinal: value.ordinal,
    assetId: requiredUlid(value, 'assetId'),
    assetCode: requiredString(value, 'assetCode', 64),
    assetName: requiredString(value, 'assetName', 255),
    laboratory: parseLaboratory(value.laboratory),
    publicId: value.publicId,
    tokenVersion: value.tokenVersion,
    scanPath,
  };
}

function parseBatchEvent(value: unknown): AssetQrLabelBatchEvent {
  if (!isRecord(value)) throw new AssetQrContractError();
  assertOnlyKeys(value, ['type', 'actorName', 'payload', 'createdAt']);
  if (!['generated', 'reprinted'].includes(String(value.type)) || !isRecord(value.payload)) throw new AssetQrContractError();
  return {
    type: value.type as AssetQrLabelBatchEvent['type'],
    actorName: requiredString(value, 'actorName', 255),
    payload: { ...value.payload },
    createdAt: requiredDateTime(value, 'createdAt'),
  };
}

export function parseAssetQrLabelBatch(value: unknown): AssetQrLabelBatch {
  if (!isRecord(value)) throw new AssetQrContractError();
  const allowed = ['id', 'templateKey', 'filters', 'assetCount', 'laboratory', 'generatedByName', 'generatedAt', 'items', 'events'] as const;
  const required = ['id', 'templateKey', 'filters', 'assetCount', 'laboratory', 'generatedByName', 'generatedAt'] as const;
  assertOnlyKeys(value, allowed, required);
  if (!(ASSET_QR_LABEL_TEMPLATES as readonly unknown[]).includes(value.templateKey) || !positiveInteger(value.assetCount) || value.assetCount > 500) {
    throw new AssetQrContractError();
  }
  const batch: AssetQrLabelBatch = {
    id: requiredUlid(value, 'id'),
    templateKey: value.templateKey as AssetQrLabelTemplate,
    filters: parseAssetQrLabelSelection(value.filters),
    assetCount: value.assetCount,
    laboratory: parseLaboratory(value.laboratory),
    generatedByName: requiredString(value, 'generatedByName', 255),
    generatedAt: requiredDateTime(value, 'generatedAt'),
  };
  if ('items' in value) {
    if (!Array.isArray(value.items)) throw new AssetQrContractError();
    batch.items = value.items.map(parseBatchItem);
    if (batch.items.length !== batch.assetCount) throw new AssetQrContractError('Jumlah snapshot item label tidak konsisten.');
  }
  if ('events' in value) {
    if (!Array.isArray(value.events)) throw new AssetQrContractError();
    batch.events = value.events.map(parseBatchEvent);
  }
  return batch;
}

function parseBatchEnvelope(value: unknown): AssetQrLabelBatch {
  if (!isRecord(value)) throw new AssetQrContractError();
  assertOnlyKeys(value, ['data']);
  return parseAssetQrLabelBatch(value.data);
}

function parseBatchPage(value: unknown): AssetQrLabelBatchPage {
  if (!isRecord(value)) throw new AssetQrContractError();
  assertOnlyKeys(value, ['data', 'meta']);
  if (!Array.isArray(value.data)) throw new AssetQrContractError();
  return { data: value.data.map(parseAssetQrLabelBatch), meta: parseMeta(value.meta, 100) };
}

export function parseAssetQrIdentity(value: unknown): AssetQrIdentity {
  if (!isRecord(value)) throw new AssetQrContractError();
  assertOnlyKeys(value, ['id', 'assetId', 'publicId', 'tokenVersion', 'status', 'issuedAt', 'revokedReason', 'revokedAt']);
  if (!isUuid(value.publicId) || !positiveInteger(value.tokenVersion) || !['active', 'revoked'].includes(String(value.status))) {
    throw new AssetQrContractError();
  }
  const revokedReason = value.revokedReason;
  const revokedAt = value.revokedAt;
  if (revokedReason !== null && (typeof revokedReason !== 'string' || revokedReason.length > 1000)) throw new AssetQrContractError();
  if (revokedAt !== null && (typeof revokedAt !== 'string' || Number.isNaN(Date.parse(revokedAt)))) throw new AssetQrContractError();
  if (value.status === 'active' && (revokedReason !== null || revokedAt !== null)) throw new AssetQrContractError();
  return {
    id: requiredUlid(value, 'id'),
    assetId: requiredUlid(value, 'assetId'),
    publicId: value.publicId,
    tokenVersion: value.tokenVersion,
    status: value.status as AssetQrIdentity['status'],
    issuedAt: requiredDateTime(value, 'issuedAt'),
    revokedReason: revokedReason as string | null,
    revokedAt: revokedAt as string | null,
  };
}

function parseIdentityEnvelope(value: unknown): AssetQrIdentity {
  if (!isRecord(value)) throw new AssetQrContractError();
  assertOnlyKeys(value, ['data']);
  return parseAssetQrIdentity(value.data);
}

function encodePathId(value: string, label: string): string {
  if (!isUlid(value)) throw new AssetQrContractError(`${label} tidak valid.`);
  return encodeURIComponent(value);
}

function setOptionalSelection(parameters: URLSearchParams, filters: AssetQrLabelSelection): void {
  if (filters.laboratoryId !== undefined && filters.laboratoryId !== null) parameters.set('laboratoryId', encodePathId(filters.laboratoryId, 'Laboratory ID'));
  if (filters.category !== undefined) {
    const value = filters.category.trim();
    if (value === '' || value.length > 100) throw new AssetQrContractError('Kategori label tidak valid.');
    parameters.set('category', value);
  }
  if (filters.condition !== undefined) parameters.set('condition', filters.condition);
  if (filters.lifecycleStatus !== undefined) parameters.set('lifecycleStatus', filters.lifecycleStatus);
  if (filters.linkStatus !== undefined) parameters.set('linkStatus', filters.linkStatus);
  if (filters.qrStatus !== undefined) parameters.set('qrStatus', filters.qrStatus);
  if (filters.printedStatus !== undefined) parameters.set('printedStatus', filters.printedStatus);
  if (filters.search !== undefined) {
    const value = filters.search.trim();
    if (value === '' || value.length > 255) throw new AssetQrContractError('Pencarian label tidak valid.');
    parameters.set('search', value);
  }
}

export function buildAssetQrCandidatePath(filters: AssetQrLabelCandidateFilters = {}): string {
  const parameters = new URLSearchParams();
  setOptionalSelection(parameters, filters);
  if (filters.page !== undefined) {
    if (!positiveInteger(filters.page)) throw new AssetQrContractError('Halaman kandidat tidak valid.');
    parameters.set('page', String(filters.page));
  }
  if (filters.perPage !== undefined) {
    if (!positiveInteger(filters.perPage) || filters.perPage > 500) throw new AssetQrContractError('Ukuran halaman kandidat tidak valid.');
    parameters.set('perPage', String(filters.perPage));
  }
  const query = parameters.toString();
  return query === '' ? '/asset-qr-label-candidates' : `/asset-qr-label-candidates?${query}`;
}

function buildBatchListPath(filters: { laboratoryId?: string; page?: number; perPage?: number } = {}): string {
  const parameters = new URLSearchParams();
  if (filters.laboratoryId !== undefined) parameters.set('laboratoryId', encodePathId(filters.laboratoryId, 'Laboratory ID'));
  if (filters.page !== undefined) {
    if (!positiveInteger(filters.page)) throw new AssetQrContractError('Halaman batch tidak valid.');
    parameters.set('page', String(filters.page));
  }
  if (filters.perPage !== undefined) {
    if (!positiveInteger(filters.perPage) || filters.perPage > 100) throw new AssetQrContractError('Ukuran halaman batch tidak valid.');
    parameters.set('perPage', String(filters.perPage));
  }
  const query = parameters.toString();
  return query === '' ? '/asset-qr-label-batches' : `/asset-qr-label-batches?${query}`;
}

function cleanSelection(selection: AssetQrLabelSelection | undefined): AssetQrLabelSelection | undefined {
  if (selection === undefined) return undefined;
  const parameters = new URLSearchParams();
  setOptionalSelection(parameters, selection);
  const result: AssetQrLabelSelection = {};
  for (const field of SELECTION_FIELDS) {
    const value = selection[field];
    if (value !== undefined) Object.assign(result, { [field]: typeof value === 'string' ? value.trim() : value });
  }
  return result;
}

function validateReason(reason: string): string {
  const value = reason.trim();
  if (value.length < 3 || value.length > 1000) throw new AssetQrContractError('Alasan QR harus 3–1000 karakter.');
  return value;
}

function qrIfMatch(version: number): string {
  if (!positiveInteger(version)) throw new AssetQrContractError('Versi token QR tidak valid.');
  return `"${version}"`;
}

export function createAssetQrGateway(client: ApiClient): AssetQrGateway {
  return {
    async candidates(filters = {}) {
      return parseCandidatePage(await client.get<unknown>(buildAssetQrCandidatePath(filters)));
    },
    async listBatches(filters = {}) {
      return parseBatchPage(await client.get<unknown>(buildBatchListPath(filters)));
    },
    async generateBatch(input) {
      if (!(ASSET_QR_LABEL_TEMPLATES as readonly unknown[]).includes(input.templateKey)) throw new AssetQrContractError('Template label tidak valid.');
      if (input.assetIds.length < 1 || input.assetIds.length > 500 || new Set(input.assetIds).size !== input.assetIds.length || input.assetIds.some((id) => !isUlid(id))) {
        throw new AssetQrContractError('Exact Asset selection tidak valid.');
      }
      const selection = cleanSelection(input.selection);
      return parseBatchEnvelope(await client.post<unknown>('/asset-qr-label-batches', {
        templateKey: input.templateKey,
        assetIds: input.assetIds,
        ...(selection === undefined ? {} : { selection }),
      }));
    },
    async showBatch(batchId) {
      return parseBatchEnvelope(await client.get<unknown>(`/asset-qr-label-batches/${encodePathId(batchId, 'Batch ID')}`));
    },
    async reprintBatch(batchId, reason) {
      return parseBatchEnvelope(await client.post<unknown>(
        `/asset-qr-label-batches/${encodePathId(batchId, 'Batch ID')}/reprint`,
        { reason: validateReason(reason) },
      ));
    },
    async history(assetId) {
      const value = await client.get<unknown>(`/assets/${encodePathId(assetId, 'Asset ID')}/qr-identities`);
      if (!isRecord(value)) throw new AssetQrContractError();
      assertOnlyKeys(value, ['data']);
      if (!Array.isArray(value.data)) throw new AssetQrContractError();
      return value.data.map(parseAssetQrIdentity);
    },
    async issue(assetId) {
      return parseIdentityEnvelope(await client.post<unknown>(`/assets/${encodePathId(assetId, 'Asset ID')}/qr-identities`));
    },
    async rotate(assetId, tokenVersion, reason) {
      return parseIdentityEnvelope(await client.post<unknown>(
        `/assets/${encodePathId(assetId, 'Asset ID')}/qr-identities/rotate`,
        { reason: validateReason(reason) },
        { ifMatch: qrIfMatch(tokenVersion) },
      ));
    },
    async revoke(assetId, tokenVersion, reason) {
      return parseIdentityEnvelope(await client.post<unknown>(
        `/assets/${encodePathId(assetId, 'Asset ID')}/qr-identities/revoke`,
        { reason: validateReason(reason) },
        { ifMatch: qrIfMatch(tokenVersion) },
      ));
    },
  };
}

export const assetQrGateway = createAssetQrGateway(apiClient);
