import { apiClient, type ApiClient } from '@/lib/apiClient';

export const DEVICE_TYPES = [
  'desktop_pc',
  'laptop',
  'server',
  'network_switch',
  'router',
  'access_point',
  'printer',
  'projector',
  'ups',
  'other',
] as const;

export const DEVICE_LIFECYCLE_STATUSES = ['in_service', 'spare', 'retired', 'decommissioned'] as const;
export const MUTABLE_DEVICE_LIFECYCLE_STATUSES = ['in_service', 'spare'] as const;
export const ACCESS_POINT_BANDS = ['2.4GHz', '5GHz', '6GHz'] as const;
export const PRINTER_TECHNOLOGIES = ['inkjet', 'laser', 'dot_matrix', 'thermal', 'other'] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];
export type DeviceLifecycleStatus = (typeof DEVICE_LIFECYCLE_STATUSES)[number];
export type MutableDeviceLifecycleStatus = (typeof MUTABLE_DEVICE_LIFECYCLE_STATUSES)[number];
export type AccessPointBand = (typeof ACCESS_POINT_BANDS)[number];
export type PrinterTechnology = (typeof PRINTER_TECHNOLOGIES)[number];
export type OtherTechnicalProfileValue = string | number | boolean | null;

export interface DesktopPcApiTechnicalProfile {
  processor?: string;
  ramGB?: number;
  storageGB?: number;
  gpu?: string;
  os?: string;
}

export interface LaptopApiTechnicalProfile extends DesktopPcApiTechnicalProfile {
  display?: string;
}

export interface ServerApiTechnicalProfile {
  processor?: string;
  cpuSockets?: number;
  cpuCores?: number;
  ramGB?: number;
  storageGB?: number;
  raidLevel?: string;
  os?: string;
}

export interface NetworkSwitchApiTechnicalProfile {
  portCount?: number;
  managed?: boolean;
  poe?: boolean;
  poeBudgetWatts?: number;
  switchingCapacityGbps?: number;
  uplinkSpeedGbps?: number;
  firmwareVersion?: string;
}

export interface RouterApiTechnicalProfile {
  wanPortCount?: number;
  lanPortCount?: number;
  throughputMbps?: number;
  wifiCapable?: boolean;
  firmwareVersion?: string;
}

export interface AccessPointApiTechnicalProfile {
  wifiStandard?: string;
  bands?: AccessPointBand[];
  maxClients?: number;
  poe?: boolean;
  firmwareVersion?: string;
}

export interface PrinterApiTechnicalProfile {
  technology?: PrinterTechnology;
  color?: boolean;
  duplex?: boolean;
  networkCapable?: boolean;
  paperSize?: string;
}

export interface ProjectorApiTechnicalProfile {
  technology?: string;
  brightnessLumens?: number;
  nativeResolution?: string;
}

export interface UpsApiTechnicalProfile {
  capacityVA?: number;
  powerWatts?: number;
  batteryCount?: number;
  batteryVoltage?: number;
  runtimeMinutes?: number;
}

export type OtherApiTechnicalProfile = Record<string, OtherTechnicalProfileValue>;

export interface DeviceTechnicalProfileByType {
  desktop_pc: DesktopPcApiTechnicalProfile;
  laptop: LaptopApiTechnicalProfile;
  server: ServerApiTechnicalProfile;
  network_switch: NetworkSwitchApiTechnicalProfile;
  router: RouterApiTechnicalProfile;
  access_point: AccessPointApiTechnicalProfile;
  printer: PrinterApiTechnicalProfile;
  projector: ProjectorApiTechnicalProfile;
  ups: UpsApiTechnicalProfile;
  other: OtherApiTechnicalProfile;
}

export type DeviceApiTechnicalProfile = DeviceTechnicalProfileByType[DeviceType];

export interface DeviceDtoForType<TType extends DeviceType> {
  id: string;
  schoolId: string;
  deviceCode: string;
  qrPublicId: string;
  deviceType: TType;
  lifecycleStatus: DeviceLifecycleStatus;
  homeLaboratoryId: string | null;
  serialNumber: string | null;
  hostname: string | null;
  brand: string | null;
  model: string | null;
  technicalProfileVersion: number;
  technicalProfile: DeviceTechnicalProfileByType[TType];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type DeviceDto = { [TType in DeviceType]: DeviceDtoForType<TType> }[DeviceType];

export interface DevicePage {
  data: DeviceDto[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    lastPage: number;
  };
}

export interface DeviceListFilters {
  page?: number;
  perPage?: number;
  homeLaboratoryId?: string;
  deviceType?: DeviceType;
  lifecycleStatus?: DeviceLifecycleStatus;
  search?: string;
}

export interface CreateDeviceInput<TType extends DeviceType = DeviceType> {
  deviceCode: string;
  deviceType: TType;
  homeLaboratoryId?: string | null;
  lifecycleStatus?: MutableDeviceLifecycleStatus;
  serialNumber?: string | null;
  hostname?: string | null;
  brand?: string | null;
  model?: string | null;
  technicalProfile?: DeviceTechnicalProfileByType[TType];
}

export interface UpdateDeviceInput {
  serialNumber?: string | null;
  hostname?: string | null;
  brand?: string | null;
  model?: string | null;
  homeLaboratoryId?: string | null;
  technicalProfile?: DeviceApiTechnicalProfile;
  lifecycleStatus?: MutableDeviceLifecycleStatus;
}

export interface DeviceGateway {
  list: (filters?: DeviceListFilters) => Promise<DevicePage>;
  show: (deviceId: string) => Promise<DeviceDto>;
  create: (input: CreateDeviceInput) => Promise<DeviceDto>;
  update: (deviceId: string, expectedVersion: number, input: UpdateDeviceInput) => Promise<DeviceDto>;
}

export class DeviceContractError extends Error {
  constructor(message = 'Respons Device tidak sesuai kontrak API.') {
    super(message);
    this.name = 'DeviceContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], message?: string): void {
  if (!hasOnlyKeys(record, allowed)) throw new DeviceContractError(message);
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') throw new DeviceContractError();
  return value;
}

function nullableString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value !== null && (typeof value !== 'string' || value.length > 255)) throw new DeviceContractError();
  return value;
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function requiredUlid(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (!ULID_PATTERN.test(value)) throw new DeviceContractError();
  return value;
}

function nullableUlid(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || !ULID_PATTERN.test(value)) throw new DeviceContractError();
  return value;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function finiteNumberAtLeast(value: unknown, minimum: number, exclusive = false): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && (exclusive ? value > minimum : value >= minimum);
}

function requiredDateTime(record: Record<string, unknown>, field: 'createdAt' | 'updatedAt'): string {
  const value = requiredString(record, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || Number.isNaN(Date.parse(value))) throw new DeviceContractError();
  return value;
}

function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === 'string' && (DEVICE_TYPES as readonly string[]).includes(value);
}

function isLifecycleStatus(value: unknown): value is DeviceLifecycleStatus {
  return typeof value === 'string' && (DEVICE_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

function assertOptionalStrings(profile: Record<string, unknown>, fields: readonly string[]): void {
  fields.forEach((field) => {
    const value = profile[field];
    if (value !== undefined && (typeof value !== 'string' || value.length > 255)) throw new DeviceContractError();
  });
}

function assertOptionalBooleans(profile: Record<string, unknown>, fields: readonly string[]): void {
  fields.forEach((field) => {
    const value = profile[field];
    if (value !== undefined && typeof value !== 'boolean') throw new DeviceContractError();
  });
}

function assertOptionalNumbers(
  profile: Record<string, unknown>,
  fields: readonly string[],
  options: { integer?: boolean; minimum: number; exclusive?: boolean },
): void {
  fields.forEach((field) => {
    const value = profile[field];
    if (value === undefined) return;
    const valid = options.integer
      ? (options.minimum === 1 ? positiveSafeInteger(value) : nonNegativeSafeInteger(value))
      : finiteNumberAtLeast(value, options.minimum, options.exclusive);
    if (!valid) throw new DeviceContractError();
  });
}

const PROFILE_KEYS: Record<Exclude<DeviceType, 'other'>, readonly string[]> = {
  desktop_pc: ['processor', 'ramGB', 'storageGB', 'gpu', 'os'],
  laptop: ['processor', 'ramGB', 'storageGB', 'gpu', 'os', 'display'],
  server: ['processor', 'cpuSockets', 'cpuCores', 'ramGB', 'storageGB', 'raidLevel', 'os'],
  network_switch: ['portCount', 'managed', 'poe', 'poeBudgetWatts', 'switchingCapacityGbps', 'uplinkSpeedGbps', 'firmwareVersion'],
  router: ['wanPortCount', 'lanPortCount', 'throughputMbps', 'wifiCapable', 'firmwareVersion'],
  access_point: ['wifiStandard', 'bands', 'maxClients', 'poe', 'firmwareVersion'],
  printer: ['technology', 'color', 'duplex', 'networkCapable', 'paperSize'],
  projector: ['technology', 'brightnessLumens', 'nativeResolution'],
  ups: ['capacityVA', 'powerWatts', 'batteryCount', 'batteryVoltage', 'runtimeMinutes'],
};

function assertAllowedProfileKeys(profile: Record<string, unknown>, deviceType: Exclude<DeviceType, 'other'>): void {
  if (Object.keys(profile).some((key) => !PROFILE_KEYS[deviceType].includes(key))) throw new DeviceContractError();
}

function assertProfileSize(profile: Record<string, unknown>): void {
  const serialized = JSON.stringify(profile);
  if (new TextEncoder().encode(serialized).length > 16 * 1024) throw new DeviceContractError();
}

export function parseDeviceTechnicalProfile<TType extends DeviceType>(
  deviceType: TType,
  value: unknown,
): DeviceTechnicalProfileByType[TType] {
  if (!isRecord(value)) throw new DeviceContractError();
  const profile = { ...value };
  assertProfileSize(profile);

  if (deviceType === 'other') {
    const entries = Object.entries(profile);
    if (entries.length > 32) throw new DeviceContractError();
    entries.forEach(([key, item]) => {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) throw new DeviceContractError();
      if (item === null) return;
      if (typeof item === 'string' && [...item].length <= 500) return;
      if (typeof item === 'number' && Number.isFinite(item)) return;
      if (typeof item === 'boolean') return;
      throw new DeviceContractError();
    });
    return profile as DeviceTechnicalProfileByType[TType];
  }

  assertAllowedProfileKeys(profile, deviceType);
  switch (deviceType) {
    case 'desktop_pc':
      assertOptionalStrings(profile, ['processor', 'gpu', 'os']);
      assertOptionalNumbers(profile, ['ramGB', 'storageGB'], { minimum: 0, exclusive: true });
      break;
    case 'laptop':
      assertOptionalStrings(profile, ['processor', 'gpu', 'os', 'display']);
      assertOptionalNumbers(profile, ['ramGB', 'storageGB'], { minimum: 0, exclusive: true });
      break;
    case 'server':
      assertOptionalStrings(profile, ['processor', 'raidLevel', 'os']);
      assertOptionalNumbers(profile, ['cpuSockets', 'cpuCores'], { integer: true, minimum: 1 });
      assertOptionalNumbers(profile, ['ramGB', 'storageGB'], { minimum: 0, exclusive: true });
      break;
    case 'network_switch':
      assertOptionalNumbers(profile, ['portCount'], { integer: true, minimum: 1 });
      assertOptionalNumbers(profile, ['poeBudgetWatts', 'switchingCapacityGbps', 'uplinkSpeedGbps'], { minimum: 0 });
      assertOptionalBooleans(profile, ['managed', 'poe']);
      assertOptionalStrings(profile, ['firmwareVersion']);
      break;
    case 'router':
      assertOptionalNumbers(profile, ['wanPortCount', 'lanPortCount'], { integer: true, minimum: 0 });
      assertOptionalNumbers(profile, ['throughputMbps'], { minimum: 0 });
      assertOptionalBooleans(profile, ['wifiCapable']);
      assertOptionalStrings(profile, ['firmwareVersion']);
      break;
    case 'access_point': {
      assertOptionalStrings(profile, ['wifiStandard', 'firmwareVersion']);
      assertOptionalNumbers(profile, ['maxClients'], { integer: true, minimum: 0 });
      assertOptionalBooleans(profile, ['poe']);
      const bands = profile.bands;
      if (bands !== undefined && (!Array.isArray(bands)
        || bands.some((band) => !(ACCESS_POINT_BANDS as readonly unknown[]).includes(band))
        || new Set(bands).size !== bands.length)) throw new DeviceContractError();
      if (Array.isArray(bands)) profile.bands = [...bands];
      break;
    }
    case 'printer':
      if (profile.technology !== undefined
        && !(PRINTER_TECHNOLOGIES as readonly unknown[]).includes(profile.technology)) throw new DeviceContractError();
      assertOptionalBooleans(profile, ['color', 'duplex', 'networkCapable']);
      assertOptionalStrings(profile, ['paperSize']);
      break;
    case 'projector':
      assertOptionalStrings(profile, ['technology', 'nativeResolution']);
      assertOptionalNumbers(profile, ['brightnessLumens'], { minimum: 0 });
      break;
    case 'ups':
      assertOptionalNumbers(profile, ['batteryCount'], { integer: true, minimum: 0 });
      assertOptionalNumbers(profile, ['capacityVA', 'powerWatts', 'batteryVoltage', 'runtimeMinutes'], { minimum: 0 });
      break;
  }

  return profile as DeviceTechnicalProfileByType[TType];
}

const DEVICE_FIELDS = [
  'id', 'schoolId', 'deviceCode', 'qrPublicId', 'deviceType', 'lifecycleStatus', 'homeLaboratoryId',
  'serialNumber', 'hostname', 'brand', 'model', 'technicalProfileVersion', 'technicalProfile', 'version',
  'createdAt', 'updatedAt',
] as const;

export function parseDevice(value: unknown): DeviceDto {
  if (!isRecord(value)) throw new DeviceContractError();
  assertExactKeys(value, DEVICE_FIELDS);
  const deviceType = value.deviceType;
  const lifecycleStatus = value.lifecycleStatus;
  if (!isDeviceType(deviceType) || !isLifecycleStatus(lifecycleStatus)) throw new DeviceContractError();
  if (!positiveSafeInteger(value.technicalProfileVersion) || !positiveSafeInteger(value.version)) throw new DeviceContractError();
  const deviceCode = requiredString(value, 'deviceCode');
  const qrPublicId = requiredString(value, 'qrPublicId');
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(deviceCode) || !/^devq_[A-Za-z0-9_-]{22}$/.test(qrPublicId)) {
    throw new DeviceContractError();
  }

  return {
    id: requiredUlid(value, 'id'),
    schoolId: requiredUlid(value, 'schoolId'),
    deviceCode,
    qrPublicId,
    deviceType,
    lifecycleStatus,
    homeLaboratoryId: nullableUlid(value, 'homeLaboratoryId'),
    serialNumber: nullableString(value, 'serialNumber'),
    hostname: nullableString(value, 'hostname'),
    brand: nullableString(value, 'brand'),
    model: nullableString(value, 'model'),
    technicalProfileVersion: value.technicalProfileVersion,
    technicalProfile: parseDeviceTechnicalProfile(deviceType, value.technicalProfile),
    version: value.version,
    createdAt: requiredDateTime(value, 'createdAt'),
    updatedAt: requiredDateTime(value, 'updatedAt'),
  } as DeviceDto;
}

export function parseDeviceResponse(value: unknown): DeviceDto {
  if (!isRecord(value)) throw new DeviceContractError('Envelope Device tidak valid.');
  assertExactKeys(value, ['data'], 'Envelope Device tidak valid.');
  return parseDevice(value.data);
}

export function parseDeviceCollectionResponse(value: unknown): DevicePage {
  if (!isRecord(value)) throw new DeviceContractError('Envelope koleksi Device tidak valid.');
  assertExactKeys(value, ['data', 'meta'], 'Envelope koleksi Device tidak valid.');
  if (!Array.isArray(value.data) || !isRecord(value.meta)) throw new DeviceContractError('Envelope koleksi Device tidak valid.');
  assertExactKeys(value.meta, ['page', 'perPage', 'total', 'lastPage'], 'Metadata koleksi Device tidak valid.');
  const { page, perPage, total, lastPage } = value.meta;
  if (!positiveSafeInteger(page)
    || !positiveSafeInteger(perPage)
    || perPage > 100
    || !nonNegativeSafeInteger(total)
    || !positiveSafeInteger(lastPage)) throw new DeviceContractError('Metadata koleksi Device tidak valid.');
  return {
    data: value.data.map(parseDevice),
    meta: { page, perPage, total, lastPage },
  };
}

export function buildCreateDevicePayload(input: CreateDeviceInput): CreateDeviceInput {
  const payload: CreateDeviceInput = {
    deviceCode: input.deviceCode,
    deviceType: input.deviceType,
  };
  if (input.homeLaboratoryId !== undefined) payload.homeLaboratoryId = input.homeLaboratoryId;
  if (input.lifecycleStatus !== undefined) payload.lifecycleStatus = input.lifecycleStatus;
  if (input.serialNumber !== undefined) payload.serialNumber = input.serialNumber;
  if (input.hostname !== undefined) payload.hostname = input.hostname;
  if (input.brand !== undefined) payload.brand = input.brand;
  if (input.model !== undefined) payload.model = input.model;
  if (input.technicalProfile !== undefined) payload.technicalProfile = input.technicalProfile;
  return payload;
}

export function buildUpdateDevicePayload(input: UpdateDeviceInput): UpdateDeviceInput {
  const payload: UpdateDeviceInput = {};
  if (input.serialNumber !== undefined) payload.serialNumber = input.serialNumber;
  if (input.hostname !== undefined) payload.hostname = input.hostname;
  if (input.brand !== undefined) payload.brand = input.brand;
  if (input.model !== undefined) payload.model = input.model;
  if (input.homeLaboratoryId !== undefined) payload.homeLaboratoryId = input.homeLaboratoryId;
  if (input.technicalProfile !== undefined) payload.technicalProfile = input.technicalProfile;
  if (input.lifecycleStatus !== undefined) payload.lifecycleStatus = input.lifecycleStatus;
  if (Object.keys(payload).length === 0) throw new DeviceContractError('Tidak ada field Device yang dapat diperbarui.');
  return payload;
}

export function deviceIfMatch(version: number): string {
  if (!positiveSafeInteger(version)) throw new DeviceContractError('Versi Device tidak valid.');
  return `"${version}"`;
}

export function devicePath(deviceId: string): string {
  if (deviceId.trim() === '') throw new DeviceContractError('ID Device tidak valid.');
  return `/devices/${encodeURIComponent(deviceId)}`;
}

export function buildDeviceListPath(filters: DeviceListFilters = {}): string {
  const parameters = new URLSearchParams();
  if (filters.page !== undefined) {
    if (!positiveSafeInteger(filters.page)) throw new DeviceContractError('Halaman Device tidak valid.');
    parameters.set('page', String(filters.page));
  }
  if (filters.perPage !== undefined) {
    if (!positiveSafeInteger(filters.perPage) || filters.perPage > 100) throw new DeviceContractError('Ukuran halaman Device tidak valid.');
    parameters.set('perPage', String(filters.perPage));
  }
  if (filters.homeLaboratoryId !== undefined) {
    if (filters.homeLaboratoryId.trim() === '') throw new DeviceContractError('ID Laboratory filter tidak valid.');
    parameters.set('homeLaboratoryId', filters.homeLaboratoryId);
  }
  if (filters.deviceType !== undefined) {
    if (!isDeviceType(filters.deviceType)) throw new DeviceContractError('Jenis Device filter tidak valid.');
    parameters.set('deviceType', filters.deviceType);
  }
  if (filters.lifecycleStatus !== undefined) {
    if (!isLifecycleStatus(filters.lifecycleStatus)) throw new DeviceContractError('Lifecycle Device filter tidak valid.');
    parameters.set('lifecycleStatus', filters.lifecycleStatus);
  }
  if (filters.search !== undefined) {
    const search = filters.search.trim();
    if (search.length < 1 || search.length > 100) throw new DeviceContractError('Pencarian Device tidak valid.');
    parameters.set('search', search);
  }
  const query = parameters.toString();
  return query === '' ? '/devices' : `/devices?${query}`;
}

export function createDeviceGateway(client: ApiClient): DeviceGateway {
  return {
    async list(filters = {}) {
      return parseDeviceCollectionResponse(await client.get<unknown>(buildDeviceListPath(filters)));
    },
    async show(deviceId) {
      return parseDeviceResponse(await client.get<unknown>(devicePath(deviceId)));
    },
    async create(input) {
      return parseDeviceResponse(await client.post<unknown>('/devices', buildCreateDevicePayload(input)));
    },
    async update(deviceId, expectedVersion, input) {
      return parseDeviceResponse(await client.patch<unknown>(
        devicePath(deviceId),
        buildUpdateDevicePayload(input),
        { ifMatch: deviceIfMatch(expectedVersion) },
      ));
    },
  };
}

export const deviceGateway = createDeviceGateway(apiClient);
