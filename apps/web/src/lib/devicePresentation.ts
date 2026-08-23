import { ApiClientError } from '@/lib/apiClient';
import {
  ACCESS_POINT_BANDS,
  DEVICE_LIFECYCLE_STATUSES,
  DEVICE_TYPES,
  MUTABLE_DEVICE_LIFECYCLE_STATUSES,
  DeviceContractError,
  parseDeviceTechnicalProfile,
  type CreateDeviceInput,
  type DeviceApiTechnicalProfile,
  type DeviceDto,
  type DeviceGateway,
  type DeviceLifecycleStatus,
  type DeviceType,
  type MutableDeviceLifecycleStatus,
  type UpdateDeviceInput,
} from '@/services/deviceApi';

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  desktop_pc: 'Desktop PC',
  laptop: 'Laptop',
  server: 'Server',
  network_switch: 'Network Switch',
  router: 'Router',
  access_point: 'Access Point',
  printer: 'Printer',
  projector: 'Proyektor',
  ups: 'UPS',
  other: 'Lainnya',
};

export const DEVICE_LIFECYCLE_LABELS: Record<DeviceLifecycleStatus, string> = {
  in_service: 'Dalam layanan',
  spare: 'Cadangan',
  retired: 'Dipensiunkan',
  decommissioned: 'Dinonaktifkan permanen',
};

export interface DeviceFormValues {
  deviceCode: string;
  deviceType: DeviceType;
  lifecycleStatus: DeviceLifecycleStatus;
  homeLaboratoryId: string;
  serialNumber: string;
  hostname: string;
  brand: string;
  model: string;
  technicalProfile: Record<string, unknown>;
  otherProfileJson: string;
}

export type DeviceFormField =
  | 'deviceCode'
  | 'deviceType'
  | 'lifecycleStatus'
  | 'homeLaboratoryId'
  | 'serialNumber'
  | 'hostname'
  | 'brand'
  | 'model'
  | 'technicalProfile'
  | 'request';

export type DeviceFormErrors = Partial<Record<DeviceFormField, string>>;

export interface NormalizedDeviceForm {
  deviceCode: string;
  deviceType: DeviceType;
  lifecycleStatus: DeviceLifecycleStatus;
  homeLaboratoryId: string | null;
  serialNumber: string | null;
  hostname: string | null;
  brand: string | null;
  model: string | null;
  technicalProfile: DeviceApiTechnicalProfile;
}

export type DevicePresentationIssue = {
  message: string;
  retryable: boolean;
  authBoundary: boolean;
  notFound: boolean;
  versionConflict: boolean;
  preconditionFailure: boolean;
  fieldErrors: DeviceFormErrors;
};

export function loadLatestDeviceAfterConflict(
  gateway: Pick<DeviceGateway, 'show'>,
  deviceId: string,
): Promise<DeviceDto> {
  return gateway.show(deviceId);
}

export type DeviceProfileFieldKind = 'text' | 'number' | 'integer' | 'boolean' | 'bands' | 'printer_technology';

export interface DeviceProfileFieldDefinition {
  key: string;
  label: string;
  kind: DeviceProfileFieldKind;
  minimum?: number;
}

export const DEVICE_PROFILE_FIELDS: Record<Exclude<DeviceType, 'other'>, readonly DeviceProfileFieldDefinition[]> = {
  desktop_pc: [
    { key: 'processor', label: 'Processor', kind: 'text' },
    { key: 'ramGB', label: 'RAM (GB)', kind: 'number', minimum: 0.01 },
    { key: 'storageGB', label: 'Penyimpanan (GB)', kind: 'number', minimum: 0.01 },
    { key: 'gpu', label: 'GPU', kind: 'text' },
    { key: 'os', label: 'Sistem Operasi', kind: 'text' },
  ],
  laptop: [
    { key: 'processor', label: 'Processor', kind: 'text' },
    { key: 'ramGB', label: 'RAM (GB)', kind: 'number', minimum: 0.01 },
    { key: 'storageGB', label: 'Penyimpanan (GB)', kind: 'number', minimum: 0.01 },
    { key: 'gpu', label: 'GPU', kind: 'text' },
    { key: 'os', label: 'Sistem Operasi', kind: 'text' },
    { key: 'display', label: 'Layar', kind: 'text' },
  ],
  server: [
    { key: 'processor', label: 'Processor', kind: 'text' },
    { key: 'cpuSockets', label: 'CPU Socket', kind: 'integer', minimum: 1 },
    { key: 'cpuCores', label: 'CPU Core', kind: 'integer', minimum: 1 },
    { key: 'ramGB', label: 'RAM (GB)', kind: 'number', minimum: 0.01 },
    { key: 'storageGB', label: 'Penyimpanan (GB)', kind: 'number', minimum: 0.01 },
    { key: 'raidLevel', label: 'RAID', kind: 'text' },
    { key: 'os', label: 'Sistem Operasi', kind: 'text' },
  ],
  network_switch: [
    { key: 'portCount', label: 'Jumlah Port', kind: 'integer', minimum: 1 },
    { key: 'managed', label: 'Managed', kind: 'boolean' },
    { key: 'poe', label: 'PoE', kind: 'boolean' },
    { key: 'poeBudgetWatts', label: 'PoE Budget (W)', kind: 'number', minimum: 0 },
    { key: 'switchingCapacityGbps', label: 'Switching Capacity (Gbps)', kind: 'number', minimum: 0 },
    { key: 'uplinkSpeedGbps', label: 'Uplink (Gbps)', kind: 'number', minimum: 0 },
    { key: 'firmwareVersion', label: 'Versi Firmware', kind: 'text' },
  ],
  router: [
    { key: 'wanPortCount', label: 'Port WAN', kind: 'integer', minimum: 0 },
    { key: 'lanPortCount', label: 'Port LAN', kind: 'integer', minimum: 0 },
    { key: 'throughputMbps', label: 'Throughput (Mbps)', kind: 'number', minimum: 0 },
    { key: 'wifiCapable', label: 'Mendukung Wi-Fi', kind: 'boolean' },
    { key: 'firmwareVersion', label: 'Versi Firmware', kind: 'text' },
  ],
  access_point: [
    { key: 'wifiStandard', label: 'Standar Wi-Fi', kind: 'text' },
    { key: 'bands', label: 'Band', kind: 'bands' },
    { key: 'maxClients', label: 'Maksimum Klien', kind: 'integer', minimum: 0 },
    { key: 'poe', label: 'PoE', kind: 'boolean' },
    { key: 'firmwareVersion', label: 'Versi Firmware', kind: 'text' },
  ],
  printer: [
    { key: 'technology', label: 'Teknologi', kind: 'printer_technology' },
    { key: 'color', label: 'Cetak Warna', kind: 'boolean' },
    { key: 'duplex', label: 'Duplex', kind: 'boolean' },
    { key: 'networkCapable', label: 'Mendukung Jaringan', kind: 'boolean' },
    { key: 'paperSize', label: 'Ukuran Kertas', kind: 'text' },
  ],
  projector: [
    { key: 'technology', label: 'Teknologi', kind: 'text' },
    { key: 'brightnessLumens', label: 'Kecerahan (lumen)', kind: 'number', minimum: 0 },
    { key: 'nativeResolution', label: 'Resolusi Native', kind: 'text' },
  ],
  ups: [
    { key: 'capacityVA', label: 'Kapasitas (VA)', kind: 'number', minimum: 0 },
    { key: 'powerWatts', label: 'Daya (W)', kind: 'number', minimum: 0 },
    { key: 'batteryCount', label: 'Jumlah Baterai', kind: 'integer', minimum: 0 },
    { key: 'batteryVoltage', label: 'Tegangan Baterai (V)', kind: 'number', minimum: 0 },
    { key: 'runtimeMinutes', label: 'Runtime (menit)', kind: 'number', minimum: 0 },
  ],
};

export function emptyDeviceForm(): DeviceFormValues {
  return {
    deviceCode: '',
    deviceType: 'desktop_pc',
    lifecycleStatus: 'in_service',
    homeLaboratoryId: '',
    serialNumber: '',
    hostname: '',
    brand: '',
    model: '',
    technicalProfile: {},
    otherProfileJson: '{}',
  };
}

export function deviceFormFromDto(device: DeviceDto): DeviceFormValues {
  return {
    deviceCode: device.deviceCode,
    deviceType: device.deviceType,
    lifecycleStatus: device.lifecycleStatus,
    homeLaboratoryId: device.homeLaboratoryId ?? '',
    serialNumber: device.serialNumber ?? '',
    hostname: device.hostname ?? '',
    brand: device.brand ?? '',
    model: device.model ?? '',
    technicalProfile: { ...device.technicalProfile },
    otherProfileJson: JSON.stringify(device.technicalProfile, null, 2),
  };
}

function nullableTrimmed(value: string, field: DeviceFormField, errors: DeviceFormErrors): string | null {
  const normalized = value.trim();
  if (normalized.length > 255) errors[field] = 'Nilai maksimal 255 karakter.';
  return normalized === '' ? null : normalized;
}

function parseOtherProfile(value: string, errors: DeviceFormErrors): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    errors.technicalProfile = 'Profil lainnya harus berupa objek JSON yang valid.';
    return null;
  }
}

export function validateDeviceForm(values: DeviceFormValues):
  | { ok: true; value: NormalizedDeviceForm }
  | { ok: false; errors: DeviceFormErrors } {
  const errors: DeviceFormErrors = {};
  const deviceCode = values.deviceCode.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(deviceCode)) {
    errors.deviceCode = 'Kode wajib 3–32 karakter dan hanya boleh berisi A–Z, angka, atau tanda hubung.';
  }
  if (!(DEVICE_TYPES as readonly string[]).includes(values.deviceType)) errors.deviceType = 'Jenis perangkat tidak valid.';
  if (!(DEVICE_LIFECYCLE_STATUSES as readonly string[]).includes(values.lifecycleStatus)) {
    errors.lifecycleStatus = 'Lifecycle perangkat tidak valid.';
  }
  const serialNumber = nullableTrimmed(values.serialNumber, 'serialNumber', errors);
  const hostname = nullableTrimmed(values.hostname, 'hostname', errors);
  const brand = nullableTrimmed(values.brand, 'brand', errors);
  const model = nullableTrimmed(values.model, 'model', errors);
  const profileValue = values.deviceType === 'other'
    ? parseOtherProfile(values.otherProfileJson, errors)
    : values.technicalProfile;
  let technicalProfile: DeviceApiTechnicalProfile = {};
  if (!errors.technicalProfile) {
    try {
      technicalProfile = parseDeviceTechnicalProfile(values.deviceType, profileValue);
    } catch {
      errors.technicalProfile = 'Profil teknis tidak sesuai dengan jenis perangkat yang dipilih.';
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      deviceCode,
      deviceType: values.deviceType,
      lifecycleStatus: values.lifecycleStatus,
      homeLaboratoryId: values.homeLaboratoryId.trim() || null,
      serialNumber,
      hostname,
      brand,
      model,
      technicalProfile,
    },
  };
}

export function createDeviceInputFromForm(value: NormalizedDeviceForm): CreateDeviceInput {
  if (!(MUTABLE_DEVICE_LIFECYCLE_STATUSES as readonly string[]).includes(value.lifecycleStatus)) {
    throw new DeviceContractError('Lifecycle Device baru tidak valid.');
  }
  return {
    deviceCode: value.deviceCode,
    deviceType: value.deviceType,
    homeLaboratoryId: value.homeLaboratoryId,
    lifecycleStatus: value.lifecycleStatus as MutableDeviceLifecycleStatus,
    serialNumber: value.serialNumber,
    hostname: value.hostname,
    brand: value.brand,
    model: value.model,
    technicalProfile: value.technicalProfile,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function canonicalDeviceValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function changedDeviceFields(current: DeviceDto, next: NormalizedDeviceForm): UpdateDeviceInput {
  const changes: UpdateDeviceInput = {};
  if (current.serialNumber !== next.serialNumber) changes.serialNumber = next.serialNumber;
  if (current.hostname !== next.hostname) changes.hostname = next.hostname;
  if (current.brand !== next.brand) changes.brand = next.brand;
  if (current.model !== next.model) changes.model = next.model;
  if (current.homeLaboratoryId === null && next.homeLaboratoryId !== null) {
    changes.homeLaboratoryId = next.homeLaboratoryId;
  }
  if (!canonicalDeviceValuesEqual(current.technicalProfile, next.technicalProfile)) {
    changes.technicalProfile = next.technicalProfile;
  }
  if ((current.lifecycleStatus === 'in_service' || current.lifecycleStatus === 'spare')
    && (next.lifecycleStatus === 'in_service' || next.lifecycleStatus === 'spare')
    && current.lifecycleStatus !== next.lifecycleStatus) {
    changes.lifecycleStatus = next.lifecycleStatus;
  }
  return changes;
}

export function sortDevices(devices: readonly DeviceDto[]): DeviceDto[] {
  return [...devices].sort((left, right) => left.deviceCode.localeCompare(right.deviceCode) || left.id.localeCompare(right.id));
}

function firstValidationErrors(error: ApiClientError): DeviceFormErrors {
  const allowed = new Set<DeviceFormField>([
    'deviceCode', 'deviceType', 'lifecycleStatus', 'homeLaboratoryId', 'serialNumber', 'hostname', 'brand', 'model', 'request',
  ]);
  const result: DeviceFormErrors = {};
  Object.entries(error.errors ?? {}).forEach(([field, messages]) => {
    if (messages.length === 0) return;
    if (field === 'technicalProfile' || field.startsWith('technicalProfile.')) {
      result.technicalProfile ??= messages[0];
    } else if (allowed.has(field as DeviceFormField)) {
      result[field as DeviceFormField] = messages[0];
    }
  });
  return result;
}

export function devicePresentationIssue(error: unknown): DevicePresentationIssue {
  const fallback: DevicePresentationIssue = {
    message: 'Data perangkat tidak dapat diproses. Silakan coba lagi.',
    retryable: true,
    authBoundary: false,
    notFound: false,
    versionConflict: false,
    preconditionFailure: false,
    fieldErrors: {},
  };

  if (error instanceof DeviceContractError) {
    return { ...fallback, message: 'Respons Device dari server tidak sesuai kontrak yang diharapkan.' };
  }
  if (!(error instanceof ApiClientError)) return fallback;
  if (error.status === 401 || error.code === 'UNAUTHENTICATED') {
    return { ...fallback, message: 'Sesi Anda telah berakhir. Memeriksa ulang sesi...', retryable: false, authBoundary: true };
  }
  if (error.status === 403 || error.code === 'FORBIDDEN') {
    return { ...fallback, message: 'Anda tidak memiliki izin untuk melakukan tindakan ini.', retryable: false };
  }
  if (error.status === 404 || error.code === 'DEVICE_NOT_FOUND') {
    return { ...fallback, message: 'Perangkat tidak ditemukan pada konteks sekolah aktif.', retryable: false, notFound: true };
  }
  if (error.code === 'ACTIVE_MEMBERSHIP_REQUIRED' || error.code === 'SCHOOL_CONTEXT_REQUIRED') {
    return { ...fallback, message: 'Konteks sekolah aktif tidak tersedia. Memeriksa ulang sesi...', retryable: false, authBoundary: true };
  }
  if (error.status === 412 || error.code === 'DEVICE_VERSION_CONFLICT') {
    return {
      ...fallback,
      message: 'Data perangkat telah berubah di server. Data terbaru sudah dimuat; periksa kembali perubahan Anda sebelum menyimpan.',
      retryable: false,
      versionConflict: true,
    };
  }
  if (error.status === 428 || error.code === 'PRECONDITION_REQUIRED') {
    return {
      ...fallback,
      message: 'Versi perangkat tidak terkirim dengan benar. Muat ulang halaman sebelum mencoba lagi.',
      retryable: false,
      preconditionFailure: true,
    };
  }
  if (error.code === 'DEVICE_HOME_LABORATORY_TRANSFER_REQUIRED') {
    return { ...fallback, message: 'Perubahan laboratorium asal memerlukan alur Transfer yang belum tersedia.', retryable: false };
  }
  if (error.code === 'DEVICE_LIFECYCLE_TRANSITION_INVALID') {
    return { ...fallback, message: 'Perubahan lifecycle perangkat tidak diizinkan melalui edit biasa.', retryable: false };
  }
  if (error.status === 422 || error.code === 'VALIDATION_FAILED') {
    return {
      ...fallback,
      message: 'Periksa kembali data perangkat yang dimasukkan.',
      retryable: false,
      fieldErrors: firstValidationErrors(error),
    };
  }
  if (error.kind === 'configuration') {
    return { ...fallback, message: 'Konfigurasi API Device tidak valid.', retryable: false };
  }
  if (error.kind === 'network') {
    return { ...fallback, message: 'Layanan Device tidak dapat dijangkau. Periksa koneksi lalu coba lagi.' };
  }
  if (error.status !== undefined && error.status >= 500) {
    return { ...fallback, message: 'Server Device sedang bermasalah. Silakan coba lagi.' };
  }
  if (error.kind === 'invalid_response') {
    return { ...fallback, message: 'Server mengembalikan respons Device yang tidak valid.' };
  }
  return fallback;
}

export function deviceTechnicalProfileRows(device: DeviceDto): { key: string; label: string; value: string }[] {
  const profile = device.technicalProfile as Record<string, unknown>;
  if (device.deviceType === 'other') {
    return Object.entries(profile)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, label: key, value: value === null ? 'Kosong' : String(value) }));
  }
  return DEVICE_PROFILE_FIELDS[device.deviceType].flatMap((field) => {
    const value = profile[field.key];
    if (value === undefined) return [];
    const display = typeof value === 'boolean'
      ? (value ? 'Ya' : 'Tidak')
      : Array.isArray(value) ? value.join(', ') : String(value);
    return [{ key: field.key, label: field.label, value: display }];
  });
}

export { ACCESS_POINT_BANDS };
