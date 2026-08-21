import type {
  AccessPointBand,
  DesktopPcTechnicalProfile,
  Device,
  DeviceTechnicalProfile,
  ManagedDeviceType,
  PrinterTechnology,
} from '@/types';

export const LEGACY_DEVICE_TECHNICAL_FIELDS = [
  'processor',
  'ramGB',
  'storageGB',
  'gpu',
  'monitor',
  'os',
  'peripherals',
] as const;

const ACCESS_POINT_BANDS = ['2.4GHz', '5GHz', '6GHz'] as const satisfies readonly AccessPointBand[];
const PRINTER_TECHNOLOGIES = ['inkjet', 'laser', 'dot_matrix', 'thermal', 'other'] as const satisfies readonly PrinterTechnology[];
const TECHNICAL_PROFILE_KINDS = [
  'desktop_pc', 'laptop', 'server', 'network_switch', 'router', 'access_point', 'printer', 'projector', 'ups', 'other',
] as const satisfies readonly ManagedDeviceType[];
const TECHNICAL_PROFILE_ALLOWED_FIELDS = {
  desktop_pc: ['kind', 'processor', 'ramGB', 'storageGB', 'gpu', 'monitor', 'os', 'peripherals'],
  laptop: ['kind', 'processor', 'ramGB', 'storageGB', 'gpu', 'os', 'display', 'batteryHealthPercent'],
  server: ['kind', 'processor', 'cpuSockets', 'cpuCores', 'ramGB', 'storageGB', 'raidLevel', 'os'],
  network_switch: ['kind', 'portCount', 'managed', 'poe', 'poeBudgetWatts', 'switchingCapacityGbps', 'uplinkSpeedGbps', 'firmwareVersion'],
  router: ['kind', 'wanPortCount', 'lanPortCount', 'throughputMbps', 'wifiCapable', 'firmwareVersion'],
  access_point: ['kind', 'wifiStandard', 'bands', 'maxClients', 'poe', 'firmwareVersion'],
  printer: ['kind', 'technology', 'color', 'duplex', 'networkCapable', 'paperSize'],
  projector: ['kind', 'technology', 'brightnessLumens', 'nativeResolution', 'lampHours'],
  ups: ['kind', 'capacityVA', 'powerWatts', 'batteryCount', 'batteryVoltage', 'runtimeMinutes'],
  other: ['kind', 'specifications'],
} as const satisfies Record<ManagedDeviceType, readonly string[]>;
const DESKTOP_PERIPHERAL_FIELDS = ['monitor', 'keyboard', 'mouse', 'headset', 'network', 'ups'] as const;

export type DeviceTechnicalProfileIssueCode =
  | 'missing-technical-profile'
  | 'invalid-technical-profile-kind'
  | 'device-profile-kind-mismatch'
  | 'invalid-technical-profile-field'
  | 'unexpected-technical-profile-field'
  | 'legacy-device-technical-field';

export interface DeviceTechnicalProfileIssue {
  code: DeviceTechnicalProfileIssueCode;
  message: string;
  field?: string;
}

export type LegacyTechnicalProfileMigrationIssue = {
  code: 'unsupported-v3-device-profile-migration' | 'unexpected-v3-technical-profile';
  message: string;
  deviceId?: string;
};

export type LegacyTechnicalProfileMigrationResult =
  | { ok: true; devices: Device[] }
  | { ok: false; issues: LegacyTechnicalProfileMigrationIssue[] };

export interface DeviceTechnicalProfileDisplayRow {
  key: string;
  label: string;
  value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function invalidField(field: string): DeviceTechnicalProfileIssue {
  return {
    code: 'invalid-technical-profile-field',
    message: `Field technicalProfile.${field} tidak valid.`,
    field,
  };
}

function validateAllowedFields(
  value: Record<string, unknown>,
  allowedFields: readonly string[],
  issues: DeviceTechnicalProfileIssue[],
  prefix = '',
): void {
  Object.keys(value).forEach((field) => {
    if (!allowedFields.includes(field)) {
      const qualifiedField = prefix ? `${prefix}.${field}` : field;
      issues.push({
        code: 'unexpected-technical-profile-field',
        message: `Field technicalProfile.${qualifiedField} tidak diizinkan untuk jenis perangkat ini.`,
        field: qualifiedField,
      });
    }
  });
}

function validateOptionalString(profile: Record<string, unknown>, fields: readonly string[], issues: DeviceTechnicalProfileIssue[]): void {
  fields.forEach((field) => {
    if (profile[field] !== undefined && typeof profile[field] !== 'string') issues.push(invalidField(field));
  });
}

function validateOptionalBoolean(profile: Record<string, unknown>, fields: readonly string[], issues: DeviceTechnicalProfileIssue[]): void {
  fields.forEach((field) => {
    if (profile[field] !== undefined && typeof profile[field] !== 'boolean') issues.push(invalidField(field));
  });
}

function validateOptionalNonNegativeNumber(profile: Record<string, unknown>, fields: readonly string[], issues: DeviceTechnicalProfileIssue[]): void {
  fields.forEach((field) => {
    const value = profile[field];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) issues.push(invalidField(field));
  });
}

function validatePeripherals(value: unknown, issues: DeviceTechnicalProfileIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(invalidField('peripherals'));
    return;
  }
  validateAllowedFields(value, DESKTOP_PERIPHERAL_FIELDS, issues, 'peripherals');
  validateOptionalBoolean(value, DESKTOP_PERIPHERAL_FIELDS, issues);
  if (DESKTOP_PERIPHERAL_FIELDS.some((field) => typeof value[field] !== 'boolean')) {
    if (!issues.some((issue) => issue.field === 'peripherals')) issues.push(invalidField('peripherals'));
  }
}

export function isDeviceTechnicalProfileCompatible(deviceType: ManagedDeviceType, profile: DeviceTechnicalProfile): boolean {
  return deviceType === profile.kind;
}

export function validateDeviceTechnicalProfile(
  deviceType: ManagedDeviceType,
  profileValue: unknown,
): { valid: boolean; issues: DeviceTechnicalProfileIssue[] } {
  const issues: DeviceTechnicalProfileIssue[] = [];
  if (!isRecord(profileValue)) {
    return { valid: false, issues: [{ code: 'missing-technical-profile', message: 'Technical profile perangkat wajib tersedia.' }] };
  }
  if (typeof profileValue.kind !== 'string' || !(TECHNICAL_PROFILE_KINDS as readonly string[]).includes(profileValue.kind)) {
    return { valid: false, issues: [{ code: 'invalid-technical-profile-kind', message: 'Jenis technical profile perangkat tidak valid.', field: 'kind' }] };
  }
  const profileKind = profileValue.kind as ManagedDeviceType;
  if (deviceType !== profileKind) {
    issues.push({ code: 'device-profile-kind-mismatch', message: 'Jenis perangkat dan technical profile harus sama.', field: 'kind' });
  }

  validateAllowedFields(profileValue, TECHNICAL_PROFILE_ALLOWED_FIELDS[profileKind], issues);

  switch (profileKind) {
    case 'desktop_pc':
      validateOptionalString(profileValue, ['processor', 'gpu', 'monitor', 'os'], issues);
      validateOptionalNonNegativeNumber(profileValue, ['ramGB', 'storageGB'], issues);
      validatePeripherals(profileValue.peripherals, issues);
      break;
    case 'laptop':
      validateOptionalString(profileValue, ['processor', 'gpu', 'os', 'display'], issues);
      validateOptionalNonNegativeNumber(profileValue, ['ramGB', 'storageGB'], issues);
      if (profileValue.batteryHealthPercent !== undefined
        && (typeof profileValue.batteryHealthPercent !== 'number'
          || !Number.isFinite(profileValue.batteryHealthPercent)
          || profileValue.batteryHealthPercent < 0
          || profileValue.batteryHealthPercent > 100)) {
        issues.push(invalidField('batteryHealthPercent'));
      }
      break;
    case 'server':
      validateOptionalString(profileValue, ['processor', 'raidLevel', 'os'], issues);
      validateOptionalNonNegativeNumber(profileValue, ['cpuSockets', 'cpuCores', 'ramGB', 'storageGB'], issues);
      break;
    case 'network_switch':
      validateOptionalNonNegativeNumber(profileValue, ['portCount', 'poeBudgetWatts', 'switchingCapacityGbps', 'uplinkSpeedGbps'], issues);
      validateOptionalBoolean(profileValue, ['managed', 'poe'], issues);
      validateOptionalString(profileValue, ['firmwareVersion'], issues);
      break;
    case 'router':
      validateOptionalNonNegativeNumber(profileValue, ['wanPortCount', 'lanPortCount', 'throughputMbps'], issues);
      validateOptionalBoolean(profileValue, ['wifiCapable'], issues);
      validateOptionalString(profileValue, ['firmwareVersion'], issues);
      break;
    case 'access_point':
      validateOptionalString(profileValue, ['wifiStandard', 'firmwareVersion'], issues);
      validateOptionalNonNegativeNumber(profileValue, ['maxClients'], issues);
      validateOptionalBoolean(profileValue, ['poe'], issues);
      if (profileValue.bands !== undefined
        && (!Array.isArray(profileValue.bands)
          || profileValue.bands.some((band) => !(ACCESS_POINT_BANDS as readonly unknown[]).includes(band)))) {
        issues.push(invalidField('bands'));
      }
      break;
    case 'printer':
      if (profileValue.technology !== undefined
        && (typeof profileValue.technology !== 'string'
          || !(PRINTER_TECHNOLOGIES as readonly string[]).includes(profileValue.technology))) {
        issues.push(invalidField('technology'));
      }
      validateOptionalBoolean(profileValue, ['color', 'duplex', 'networkCapable'], issues);
      validateOptionalString(profileValue, ['paperSize'], issues);
      break;
    case 'projector':
      validateOptionalString(profileValue, ['technology', 'nativeResolution'], issues);
      validateOptionalNonNegativeNumber(profileValue, ['brightnessLumens', 'lampHours'], issues);
      break;
    case 'ups':
      validateOptionalNonNegativeNumber(profileValue, ['capacityVA', 'powerWatts', 'batteryCount', 'batteryVoltage', 'runtimeMinutes'], issues);
      break;
    case 'other':
      if (profileValue.specifications !== undefined) {
        if (!isRecord(profileValue.specifications)
          || Object.values(profileValue.specifications).some((value) => !['string', 'number', 'boolean'].includes(typeof value)
            || (typeof value === 'number' && !Number.isFinite(value)))) {
          issues.push(invalidField('specifications'));
        }
      }
      break;
  }

  return { valid: issues.length === 0, issues };
}

export function validateCanonicalDeviceTechnicalProfile(device: Device): { valid: boolean; issues: DeviceTechnicalProfileIssue[] } {
  const issues = validateDeviceTechnicalProfile(device.deviceType, device.technicalProfile).issues;
  LEGACY_DEVICE_TECHNICAL_FIELDS.forEach((field) => {
    if (hasOwn(device, field)) {
      issues.push({
        code: 'legacy-device-technical-field',
        message: `Field teknis legacy Device.${field} tidak boleh ada pada schema canonical.`,
        field,
      });
    }
  });
  return { valid: issues.length === 0, issues };
}

export function migrateLegacyDeviceTechnicalProfiles(devices: readonly unknown[]): LegacyTechnicalProfileMigrationResult {
  const migrated: Device[] = [];
  for (const value of devices) {
    if (!isRecord(value)) {
      return {
        ok: false,
        issues: [{
          code: 'unsupported-v3-device-profile-migration',
          message: 'Migrasi technical profile hanya mendukung Device desktop_pc resmi dari schema versi 3.',
          deviceId: isRecord(value) && typeof value.id === 'string' ? value.id : undefined,
        }],
      };
    }
    if (hasOwn(value, 'technicalProfile')) {
      return {
        ok: false,
        issues: [{
          code: 'unexpected-v3-technical-profile',
          message: 'Schema versi 3 resmi tidak boleh memiliki Device.technicalProfile.',
          deviceId: typeof value.id === 'string' ? value.id : undefined,
        }],
      };
    }
    if (value.deviceType !== 'desktop_pc') {
      return {
        ok: false,
        issues: [{
          code: 'unsupported-v3-device-profile-migration',
          message: 'Migrasi technical profile hanya mendukung Device desktop_pc resmi dari schema versi 3.',
          deviceId: typeof value.id === 'string' ? value.id : undefined,
        }],
      };
    }
    const {
      processor,
      ramGB,
      storageGB,
      gpu,
      monitor,
      os,
      peripherals,
      ...common
    } = value;
    const profile: Record<string, unknown> = {
      kind: 'desktop_pc',
      processor,
      ramGB,
      storageGB,
      gpu,
      monitor,
      os,
      peripherals: isRecord(peripherals) ? { ...peripherals } : peripherals,
    };
    Object.keys(profile).forEach((key) => {
      if (profile[key] === undefined) delete profile[key];
    });
    migrated.push({ ...common, technicalProfile: profile as unknown as DesktopPcTechnicalProfile } as unknown as Device);
  }
  return { ok: true, devices: migrated };
}

export function getDesktopPcTechnicalProfile(profile: DeviceTechnicalProfile): DesktopPcTechnicalProfile | null {
  return profile.kind === 'desktop_pc' ? profile : null;
}

export function isComputerTechnicalProfile(
  profile: DeviceTechnicalProfile,
): profile is Extract<DeviceTechnicalProfile, { kind: 'desktop_pc' | 'laptop' | 'server' }> {
  return profile.kind === 'desktop_pc' || profile.kind === 'laptop' || profile.kind === 'server';
}

export function getDeviceOperatingSystem(profile: DeviceTechnicalProfile): string | undefined {
  return isComputerTechnicalProfile(profile) ? profile.os : undefined;
}

function displayValue(value: unknown, suffix = ''): string | null {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (typeof value === 'string' || typeof value === 'number') return `${value}${suffix}`;
  if (Array.isArray(value)) return value.join(', ');
  return null;
}

function rows(profile: Record<string, unknown>, definitions: readonly [string, string, string?][]): DeviceTechnicalProfileDisplayRow[] {
  return definitions.flatMap(([key, label, suffix]) => {
    const value = displayValue(profile[key], suffix);
    return value === null ? [] : [{ key, label, value }];
  });
}

export function getDeviceTechnicalProfileDisplayRows(profile: DeviceTechnicalProfile): DeviceTechnicalProfileDisplayRow[] {
  const value = profile as unknown as Record<string, unknown>;
  switch (profile.kind) {
    case 'desktop_pc': return rows(value, [['processor', 'Processor'], ['ramGB', 'RAM', ' GB'], ['storageGB', 'Storage', ' GB'], ['gpu', 'GPU'], ['monitor', 'Monitor'], ['os', 'OS']]);
    case 'laptop': return rows(value, [['processor', 'Processor'], ['ramGB', 'RAM', ' GB'], ['storageGB', 'Storage', ' GB'], ['gpu', 'GPU'], ['os', 'OS'], ['display', 'Display'], ['batteryHealthPercent', 'Kesehatan Baterai', '%']]);
    case 'server': return rows(value, [['processor', 'Processor'], ['cpuSockets', 'CPU Socket'], ['cpuCores', 'CPU Core'], ['ramGB', 'RAM', ' GB'], ['storageGB', 'Storage', ' GB'], ['raidLevel', 'RAID'], ['os', 'OS']]);
    case 'network_switch': return rows(value, [['portCount', 'Jumlah Port'], ['managed', 'Managed'], ['poe', 'PoE'], ['poeBudgetWatts', 'PoE Budget', ' W'], ['switchingCapacityGbps', 'Switching Capacity', ' Gbps'], ['uplinkSpeedGbps', 'Uplink', ' Gbps'], ['firmwareVersion', 'Firmware']]);
    case 'router': return rows(value, [['wanPortCount', 'Port WAN'], ['lanPortCount', 'Port LAN'], ['throughputMbps', 'Throughput', ' Mbps'], ['wifiCapable', 'Wi-Fi'], ['firmwareVersion', 'Firmware']]);
    case 'access_point': return rows(value, [['wifiStandard', 'Standar Wi-Fi'], ['bands', 'Band'], ['maxClients', 'Maks. Klien'], ['poe', 'PoE'], ['firmwareVersion', 'Firmware']]);
    case 'printer': return rows(value, [['technology', 'Teknologi'], ['color', 'Warna'], ['duplex', 'Duplex'], ['networkCapable', 'Jaringan'], ['paperSize', 'Ukuran Kertas']]);
    case 'projector': return rows(value, [['technology', 'Teknologi'], ['brightnessLumens', 'Kecerahan', ' lumen'], ['nativeResolution', 'Resolusi Native'], ['lampHours', 'Jam Lampu', ' jam']]);
    case 'ups': return rows(value, [['capacityVA', 'Kapasitas', ' VA'], ['powerWatts', 'Daya', ' W'], ['batteryCount', 'Jumlah Baterai'], ['batteryVoltage', 'Tegangan Baterai', ' V'], ['runtimeMinutes', 'Runtime', ' menit']]);
    case 'other': return profile.specifications
      ? Object.entries(profile.specifications).map(([key, item]) => ({ key, label: key, value: String(item) }))
      : [];
  }
}
