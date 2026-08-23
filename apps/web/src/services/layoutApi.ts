import { apiClient, type ApiClient } from '@/lib/apiClient';
import { DEVICE_TYPES, type DeviceType } from '@/services/deviceApi';

export const LAYOUT_STATUSES = ['draft', 'active', 'archived'] as const;
export const STRUCTURAL_LAYOUT_ELEMENT_TYPES = ['teacher_desk', 'door', 'window', 'wall', 'aisle', 'label'] as const;
export const DEVICE_PLACEMENT_ROLES = ['student_station', 'teacher_station'] as const;
export const LAYOUT_ROTATIONS = [0, 90, 180, 270] as const;

export type LayoutStatus = (typeof LAYOUT_STATUSES)[number];
export type StructuralLayoutElementType = (typeof STRUCTURAL_LAYOUT_ELEMENT_TYPES)[number];
export type DevicePlacementStationRole = (typeof DEVICE_PLACEMENT_ROLES)[number];
export type DevicePlacementRole = DevicePlacementStationRole | null;
export type LayoutRotation = (typeof LAYOUT_ROTATIONS)[number];
export type UnplacedDeviceLifecycleStatus = 'in_service' | 'spare';

export interface LayoutSummaryDto {
  id: string;
  schoolId: string;
  laboratoryId: string;
  name: string;
  templateKey: string | null;
  rows: number;
  columns: number;
  status: LayoutStatus;
  version: number;
  activatedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StructuralLayoutElementDto {
  id: string;
  type: StructuralLayoutElementType;
  label: string | null;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  rotation: LayoutRotation;
}

export interface DevicePlacementDto {
  id: string;
  deviceId: string;
  role: DevicePlacementRole;
  label: string | null;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  rotation: LayoutRotation;
}

export interface LayoutDto extends LayoutSummaryDto {
  structuralElements: StructuralLayoutElementDto[];
  devicePlacements: DevicePlacementDto[];
}

export interface LayoutPaginationMeta {
  page: number;
  perPage: number;
  total: number;
  lastPage: number;
}

export interface LayoutPage {
  data: LayoutSummaryDto[];
  meta: LayoutPaginationMeta;
}

export interface UnplacedDeviceCandidateDto {
  id: string;
  deviceCode: string;
  deviceType: DeviceType;
  lifecycleStatus: UnplacedDeviceLifecycleStatus;
  hostname: string | null;
  brand: string | null;
  model: string | null;
}

export interface UnplacedDevicePage {
  data: UnplacedDeviceCandidateDto[];
  meta: LayoutPaginationMeta;
}

export interface LayoutListFilters {
  status?: LayoutStatus;
  page?: number;
  perPage?: number;
}

export interface UnplacedDeviceFilters {
  page?: number;
  perPage?: number;
  search?: string;
}

export interface CreateEmptyLayoutDraftInput {
  mode: 'empty';
  name: string;
  rows: number;
  columns: number;
  templateKey?: string | null;
}

export interface CloneActiveLayoutDraftInput {
  mode: 'clone';
  name?: string;
}

export type CreateLayoutDraftInput = CreateEmptyLayoutDraftInput | CloneActiveLayoutDraftInput;
export type CreateLayoutDraftPayload =
  | { name: string; rows: number; columns: number; templateKey?: string | null }
  | { name?: string };

export interface StructuralLayoutElementInput {
  id?: string;
  type: StructuralLayoutElementType;
  label?: string | null;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  rotation: LayoutRotation;
}

export interface DevicePlacementInput {
  id?: string;
  deviceId: string;
  role?: DevicePlacementRole;
  label?: string | null;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  rotation: LayoutRotation;
}

export interface ReplaceLayoutInput {
  name: string;
  templateKey: string | null;
  rows: number;
  columns: number;
  structuralElements: StructuralLayoutElementInput[];
  devicePlacements: DevicePlacementInput[];
}

export interface LayoutGateway {
  list: (laboratoryId: string, filters?: LayoutListFilters) => Promise<LayoutPage>;
  createDraft: (laboratoryId: string, input: CreateLayoutDraftInput) => Promise<LayoutDto>;
  show: (layoutId: string) => Promise<LayoutDto>;
  replace: (layoutId: string, expectedVersion: number, input: ReplaceLayoutInput) => Promise<LayoutDto>;
  activate: (layoutId: string, expectedVersion: number) => Promise<LayoutDto>;
  deleteDraft: (layoutId: string, expectedVersion: number) => Promise<void>;
  unplacedDevices: (layoutId: string, filters?: UnplacedDeviceFilters) => Promise<UnplacedDevicePage>;
}

export class LayoutContractError extends Error {
  constructor(message = 'Respons Layout tidak sesuai kontrak API.') {
    super(message);
    this.name = 'LayoutContractError';
  }
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SUMMARY_FIELDS = [
  'id', 'schoolId', 'laboratoryId', 'name', 'templateKey', 'rows', 'columns', 'status', 'version',
  'activatedAt', 'archivedAt', 'createdAt', 'updatedAt',
] as const;
const LAYOUT_FIELDS = [...SUMMARY_FIELDS, 'structuralElements', 'devicePlacements'] as const;
const STRUCTURAL_FIELDS = ['id', 'type', 'label', 'row', 'column', 'rowSpan', 'columnSpan', 'rotation'] as const;
const PLACEMENT_FIELDS = ['id', 'deviceId', 'role', 'label', 'row', 'column', 'rowSpan', 'columnSpan', 'rotation'] as const;
const UNPLACED_DEVICE_FIELDS = ['id', 'deviceCode', 'deviceType', 'lifecycleStatus', 'hostname', 'brand', 'model'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], message?: string): void {
  const keys = Object.keys(record);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new LayoutContractError(message);
  }
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requiredString(record: Record<string, unknown>, field: string, maximum: number): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) throw new LayoutContractError();
  return value;
}

function nullableString(record: Record<string, unknown>, field: string, maximum: number, rejectBlank = false): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > maximum || (rejectBlank && value.trim() === '')) throw new LayoutContractError();
  return value;
}

function requiredUlid(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field, 26);
  if (!ULID_PATTERN.test(value)) throw new LayoutContractError();
  return value;
}

function requiredDateTime(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field, 64);
  if (!DATE_TIME_PATTERN.test(value) || Number.isNaN(Date.parse(value))) throw new LayoutContractError();
  return value;
}

function nullableDateTime(record: Record<string, unknown>, field: string): string | null {
  if (record[field] === null) return null;
  return requiredDateTime(record, field);
}

function isLayoutStatus(value: unknown): value is LayoutStatus {
  return typeof value === 'string' && (LAYOUT_STATUSES as readonly string[]).includes(value);
}

function isStructuralType(value: unknown): value is StructuralLayoutElementType {
  return typeof value === 'string' && (STRUCTURAL_LAYOUT_ELEMENT_TYPES as readonly string[]).includes(value);
}

function isPlacementRole(value: unknown): value is DevicePlacementRole {
  return value === null || (typeof value === 'string' && (DEVICE_PLACEMENT_ROLES as readonly string[]).includes(value));
}

function isRotation(value: unknown): value is LayoutRotation {
  return typeof value === 'number' && (LAYOUT_ROTATIONS as readonly number[]).includes(value);
}

function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === 'string' && (DEVICE_TYPES as readonly string[]).includes(value);
}

function assertLifecycleTimestamps(status: LayoutStatus, activatedAt: string | null, archivedAt: string | null): void {
  const valid = status === 'draft'
    ? activatedAt === null && archivedAt === null
    : status === 'active'
      ? activatedAt !== null && archivedAt === null
      : activatedAt !== null && archivedAt !== null;
  if (!valid) throw new LayoutContractError();
}

function parseSummaryRecord(record: Record<string, unknown>, exactFields = true): LayoutSummaryDto {
  if (exactFields) assertExactKeys(record, SUMMARY_FIELDS);
  const status = record.status;
  if (!isLayoutStatus(status)) throw new LayoutContractError();
  if (!positiveSafeInteger(record.rows) || record.rows > 50
    || !positiveSafeInteger(record.columns) || record.columns > 50
    || !positiveSafeInteger(record.version)) throw new LayoutContractError();
  const activatedAt = nullableDateTime(record, 'activatedAt');
  const archivedAt = nullableDateTime(record, 'archivedAt');
  assertLifecycleTimestamps(status, activatedAt, archivedAt);

  return {
    id: requiredUlid(record, 'id'),
    schoolId: requiredUlid(record, 'schoolId'),
    laboratoryId: requiredUlid(record, 'laboratoryId'),
    name: requiredString(record, 'name', 255),
    templateKey: nullableString(record, 'templateKey', 100, true),
    rows: record.rows,
    columns: record.columns,
    status,
    version: record.version,
    activatedAt,
    archivedAt,
    createdAt: requiredDateTime(record, 'createdAt'),
    updatedAt: requiredDateTime(record, 'updatedAt'),
  };
}

function parseStructuralElement(value: unknown): StructuralLayoutElementDto {
  if (!isRecord(value)) throw new LayoutContractError();
  assertExactKeys(value, STRUCTURAL_FIELDS);
  const type = value.type;
  if (!isStructuralType(type) || !isRotation(value.rotation)) throw new LayoutContractError();
  if (!positiveSafeInteger(value.row) || !positiveSafeInteger(value.column)
    || !positiveSafeInteger(value.rowSpan) || !positiveSafeInteger(value.columnSpan)) throw new LayoutContractError();
  const label = nullableString(value, 'label', 60, true);
  if ((type === 'label' && label === null) || (type === 'aisle' && label !== null)) throw new LayoutContractError();
  return {
    id: requiredUlid(value, 'id'),
    type,
    label,
    row: value.row,
    column: value.column,
    rowSpan: value.rowSpan,
    columnSpan: value.columnSpan,
    rotation: value.rotation,
  };
}

function parseDevicePlacement(value: unknown): DevicePlacementDto {
  if (!isRecord(value)) throw new LayoutContractError();
  assertExactKeys(value, PLACEMENT_FIELDS);
  if (!isPlacementRole(value.role) || !isRotation(value.rotation)) throw new LayoutContractError();
  if (!positiveSafeInteger(value.row) || !positiveSafeInteger(value.column)
    || !positiveSafeInteger(value.rowSpan) || !positiveSafeInteger(value.columnSpan)) throw new LayoutContractError();
  return {
    id: requiredUlid(value, 'id'),
    deviceId: requiredUlid(value, 'deviceId'),
    role: value.role,
    label: nullableString(value, 'label', 60, true),
    row: value.row,
    column: value.column,
    rowSpan: value.rowSpan,
    columnSpan: value.columnSpan,
    rotation: value.rotation,
  };
}

type Footprint = Pick<StructuralLayoutElementDto, 'row' | 'column' | 'rowSpan' | 'columnSpan'>;

function assertAggregateGeometry(layout: Pick<LayoutDto, 'rows' | 'columns' | 'structuralElements' | 'devicePlacements'>): void {
  if (layout.structuralElements.length > 2500 || layout.devicePlacements.length > 2500
    || layout.structuralElements.length + layout.devicePlacements.length > layout.rows * layout.columns) {
    throw new LayoutContractError();
  }
  const structuralIds = new Set<string>();
  const placementIds = new Set<string>();
  const deviceIds = new Set<string>();
  const occupied = new Set<string>();
  const visit = (item: Footprint) => {
    if (!positiveSafeInteger(item.row) || !positiveSafeInteger(item.column)
      || !positiveSafeInteger(item.rowSpan) || !positiveSafeInteger(item.columnSpan)) {
      throw new LayoutContractError();
    }
    const lastRow = item.row + item.rowSpan - 1;
    const lastColumn = item.column + item.columnSpan - 1;
    if (lastRow > layout.rows || lastColumn > layout.columns) throw new LayoutContractError();
    for (let row = item.row; row <= lastRow; row += 1) {
      for (let column = item.column; column <= lastColumn; column += 1) {
        const key = `${row}:${column}`;
        if (occupied.has(key)) throw new LayoutContractError();
        occupied.add(key);
      }
    }
  };
  layout.structuralElements.forEach((element) => {
    if (structuralIds.has(element.id)) throw new LayoutContractError();
    structuralIds.add(element.id);
    visit(element);
  });
  layout.devicePlacements.forEach((placement) => {
    if (placementIds.has(placement.id) || deviceIds.has(placement.deviceId)) throw new LayoutContractError();
    placementIds.add(placement.id);
    deviceIds.add(placement.deviceId);
    visit(placement);
  });
}

export function parseLayoutSummary(value: unknown): LayoutSummaryDto {
  if (!isRecord(value)) throw new LayoutContractError();
  return parseSummaryRecord(value);
}

export function parseLayout(value: unknown): LayoutDto {
  if (!isRecord(value)) throw new LayoutContractError();
  assertExactKeys(value, LAYOUT_FIELDS);
  if (!Array.isArray(value.structuralElements) || !Array.isArray(value.devicePlacements)) throw new LayoutContractError();
  const layout: LayoutDto = {
    ...parseSummaryRecord(value, false),
    structuralElements: value.structuralElements.map(parseStructuralElement),
    devicePlacements: value.devicePlacements.map(parseDevicePlacement),
  };
  assertAggregateGeometry(layout);
  return layout;
}

function parsePaginationMeta(value: unknown): LayoutPaginationMeta {
  if (!isRecord(value)) throw new LayoutContractError('Metadata Layout tidak valid.');
  assertExactKeys(value, ['page', 'perPage', 'total', 'lastPage'], 'Metadata Layout tidak valid.');
  if (!positiveSafeInteger(value.page) || !positiveSafeInteger(value.perPage) || value.perPage > 100
    || !nonNegativeSafeInteger(value.total) || !positiveSafeInteger(value.lastPage)) {
    throw new LayoutContractError('Metadata Layout tidak valid.');
  }
  return { page: value.page, perPage: value.perPage, total: value.total, lastPage: value.lastPage };
}

export function parseLayoutResponse(value: unknown): LayoutDto {
  if (!isRecord(value)) throw new LayoutContractError('Envelope Layout tidak valid.');
  assertExactKeys(value, ['data'], 'Envelope Layout tidak valid.');
  return parseLayout(value.data);
}

export function parseLayoutCollectionResponse(value: unknown): LayoutPage {
  if (!isRecord(value)) throw new LayoutContractError('Envelope koleksi Layout tidak valid.');
  assertExactKeys(value, ['data', 'meta'], 'Envelope koleksi Layout tidak valid.');
  if (!Array.isArray(value.data)) throw new LayoutContractError('Envelope koleksi Layout tidak valid.');
  return { data: value.data.map(parseLayoutSummary), meta: parsePaginationMeta(value.meta) };
}

function parseUnplacedDeviceCandidate(value: unknown): UnplacedDeviceCandidateDto {
  if (!isRecord(value)) throw new LayoutContractError();
  assertExactKeys(value, UNPLACED_DEVICE_FIELDS);
  if (!isDeviceType(value.deviceType) || (value.lifecycleStatus !== 'in_service' && value.lifecycleStatus !== 'spare')) {
    throw new LayoutContractError();
  }
  const deviceCode = requiredString(value, 'deviceCode', 32);
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(deviceCode)) throw new LayoutContractError();
  return {
    id: requiredUlid(value, 'id'),
    deviceCode,
    deviceType: value.deviceType,
    lifecycleStatus: value.lifecycleStatus,
    hostname: nullableString(value, 'hostname', 255),
    brand: nullableString(value, 'brand', 255),
    model: nullableString(value, 'model', 255),
  };
}

export function parseUnplacedDeviceCollectionResponse(value: unknown): UnplacedDevicePage {
  if (!isRecord(value)) throw new LayoutContractError('Envelope kandidat Device tidak valid.');
  assertExactKeys(value, ['data', 'meta'], 'Envelope kandidat Device tidak valid.');
  if (!Array.isArray(value.data)) throw new LayoutContractError('Envelope kandidat Device tidak valid.');
  return { data: value.data.map(parseUnplacedDeviceCandidate), meta: parsePaginationMeta(value.meta) };
}

function assertName(value: string, required = true): void {
  if (typeof value !== 'string' || value.length > 255 || (required && value.trim() === '')) {
    throw new LayoutContractError('Nama Layout tidak valid.');
  }
}

function assertTemplateKey(value: string | null | undefined): void {
  if (value !== undefined && value !== null && (typeof value !== 'string' || value.trim() === '' || value.length > 100)) {
    throw new LayoutContractError('Template key Layout tidak valid.');
  }
}

function assertGridDimensions(rows: number, columns: number): void {
  if (!positiveSafeInteger(rows) || rows > 50 || !positiveSafeInteger(columns) || columns > 50) {
    throw new LayoutContractError('Dimensi Layout tidak valid.');
  }
}

export function buildCreateLayoutDraftPayload(input: CreateLayoutDraftInput): CreateLayoutDraftPayload {
  if (input.mode === 'clone') {
    if (input.name === undefined) return {};
    assertName(input.name);
    return { name: input.name };
  }
  assertName(input.name);
  assertGridDimensions(input.rows, input.columns);
  assertTemplateKey(input.templateKey);
  const payload: CreateLayoutDraftPayload = { name: input.name, rows: input.rows, columns: input.columns };
  if (input.templateKey !== undefined) payload.templateKey = input.templateKey;
  return payload;
}

function assertInputUlid(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !ULID_PATTERN.test(value)) throw new LayoutContractError(message);
}

function mapStructuralInput(element: StructuralLayoutElementInput): StructuralLayoutElementInput {
  if (!isStructuralType(element.type) || !isRotation(element.rotation)) throw new LayoutContractError('Elemen struktural tidak valid.');
  const label = element.label;
  if (label !== undefined && label !== null && (typeof label !== 'string' || label.trim() === '' || label.length > 60)) {
    throw new LayoutContractError('Label elemen struktural tidak valid.');
  }
  if ((element.type === 'label' && (label === undefined || label === null)) || (element.type === 'aisle' && label != null)) {
    throw new LayoutContractError('Label elemen struktural tidak valid.');
  }
  if (element.id !== undefined) assertInputUlid(element.id, 'ID elemen struktural tidak valid.');
  const payload: StructuralLayoutElementInput = {
    type: element.type,
    row: element.row,
    column: element.column,
    rowSpan: element.rowSpan,
    columnSpan: element.columnSpan,
    rotation: element.rotation,
  };
  if (element.id !== undefined) payload.id = element.id;
  if (label !== undefined) payload.label = label;
  return payload;
}

function mapPlacementInput(placement: DevicePlacementInput): DevicePlacementInput {
  assertInputUlid(placement.deviceId, 'ID Device placement tidak valid.');
  if (placement.id !== undefined) assertInputUlid(placement.id, 'ID placement tidak valid.');
  if (placement.role !== undefined && !isPlacementRole(placement.role)) throw new LayoutContractError('Role placement tidak valid.');
  if (placement.label !== undefined && placement.label !== null
    && (typeof placement.label !== 'string' || placement.label.trim() === '' || placement.label.length > 60)) {
    throw new LayoutContractError('Label placement tidak valid.');
  }
  if (!isRotation(placement.rotation)) throw new LayoutContractError('Rotasi placement tidak valid.');
  const payload: DevicePlacementInput = {
    deviceId: placement.deviceId,
    row: placement.row,
    column: placement.column,
    rowSpan: placement.rowSpan,
    columnSpan: placement.columnSpan,
    rotation: placement.rotation,
  };
  if (placement.id !== undefined) payload.id = placement.id;
  if (placement.role !== undefined) payload.role = placement.role;
  if (placement.label !== undefined) payload.label = placement.label;
  return payload;
}

export function buildReplaceLayoutPayload(input: ReplaceLayoutInput): ReplaceLayoutInput {
  assertName(input.name);
  assertTemplateKey(input.templateKey);
  assertGridDimensions(input.rows, input.columns);
  const payload: ReplaceLayoutInput = {
    name: input.name,
    templateKey: input.templateKey,
    rows: input.rows,
    columns: input.columns,
    structuralElements: input.structuralElements.map(mapStructuralInput),
    devicePlacements: input.devicePlacements.map(mapPlacementInput),
  };
  const structuralForValidation = payload.structuralElements.map((element, index) => ({
    id: element.id ?? `new-structure-${index}`,
    type: element.type,
    label: element.label ?? null,
    row: element.row,
    column: element.column,
    rowSpan: element.rowSpan,
    columnSpan: element.columnSpan,
    rotation: element.rotation,
  }));
  const placementsForValidation = payload.devicePlacements.map((placement, index) => ({
    id: placement.id ?? `new-placement-${index}`,
    deviceId: placement.deviceId,
    role: placement.role ?? null,
    label: placement.label ?? null,
    row: placement.row,
    column: placement.column,
    rowSpan: placement.rowSpan,
    columnSpan: placement.columnSpan,
    rotation: placement.rotation,
  }));
  assertAggregateGeometry({
    rows: payload.rows,
    columns: payload.columns,
    structuralElements: structuralForValidation,
    devicePlacements: placementsForValidation,
  });
  return payload;
}

export function layoutIfMatch(version: number): string {
  if (!positiveSafeInteger(version)) throw new LayoutContractError('Versi Layout tidak valid.');
  return `"${version}"`;
}

function encodedIdentifier(identifier: string, label: string): string {
  if (identifier.trim() === '') throw new LayoutContractError(`${label} tidak valid.`);
  return encodeURIComponent(identifier);
}

export function layoutPath(layoutId: string): string {
  return `/layouts/${encodedIdentifier(layoutId, 'ID Layout')}`;
}

export function laboratoryLayoutsPath(laboratoryId: string): string {
  return `/laboratories/${encodedIdentifier(laboratoryId, 'ID Laboratory')}/layouts`;
}

function appendPageFilters(parameters: URLSearchParams, page?: number, perPage?: number): void {
  if (page !== undefined) {
    if (!positiveSafeInteger(page)) throw new LayoutContractError('Halaman Layout tidak valid.');
    parameters.set('page', String(page));
  }
  if (perPage !== undefined) {
    if (!positiveSafeInteger(perPage) || perPage > 100) throw new LayoutContractError('Ukuran halaman Layout tidak valid.');
    parameters.set('perPage', String(perPage));
  }
}

export function buildLayoutListPath(laboratoryId: string, filters: LayoutListFilters = {}): string {
  const base = laboratoryLayoutsPath(laboratoryId);
  const parameters = new URLSearchParams();
  if (filters.status !== undefined) {
    if (!isLayoutStatus(filters.status)) throw new LayoutContractError('Status Layout tidak valid.');
    parameters.set('status', filters.status);
  }
  appendPageFilters(parameters, filters.page, filters.perPage);
  const query = parameters.toString();
  return query === '' ? base : `${base}?${query}`;
}

export function buildUnplacedDevicesPath(layoutId: string, filters: UnplacedDeviceFilters = {}): string {
  const base = `${layoutPath(layoutId)}/unplaced-devices`;
  const parameters = new URLSearchParams();
  appendPageFilters(parameters, filters.page, filters.perPage);
  if (filters.search !== undefined) {
    const search = filters.search.trim();
    if (search.length < 1 || search.length > 100) throw new LayoutContractError('Pencarian Device tidak valid.');
    parameters.set('search', search);
  }
  const query = parameters.toString();
  return query === '' ? base : `${base}?${query}`;
}

export function createLayoutGateway(client: ApiClient): LayoutGateway {
  return {
    async list(laboratoryId, filters = {}) {
      return parseLayoutCollectionResponse(await client.get<unknown>(buildLayoutListPath(laboratoryId, filters)));
    },
    async createDraft(laboratoryId, input) {
      return parseLayoutResponse(await client.post<unknown>(laboratoryLayoutsPath(laboratoryId), buildCreateLayoutDraftPayload(input)));
    },
    async show(layoutId) {
      return parseLayoutResponse(await client.get<unknown>(layoutPath(layoutId)));
    },
    async replace(layoutId, expectedVersion, input) {
      return parseLayoutResponse(await client.put<unknown>(
        layoutPath(layoutId),
        buildReplaceLayoutPayload(input),
        { ifMatch: layoutIfMatch(expectedVersion) },
      ));
    },
    async activate(layoutId, expectedVersion) {
      return parseLayoutResponse(await client.post<unknown>(
        `${layoutPath(layoutId)}/activate`,
        undefined,
        { ifMatch: layoutIfMatch(expectedVersion) },
      ));
    },
    async deleteDraft(layoutId, expectedVersion) {
      await client.delete(layoutPath(layoutId), { ifMatch: layoutIfMatch(expectedVersion) });
    },
    async unplacedDevices(layoutId, filters = {}) {
      return parseUnplacedDeviceCollectionResponse(await client.get<unknown>(buildUnplacedDevicesPath(layoutId, filters)));
    },
  };
}

export const layoutGateway = createLayoutGateway(apiClient);
