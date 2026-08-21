import { generateMasterData, type SeedData } from '@/data/seed';
import { migrateLegacyDeviceCoordinates, validatePersistedLaboratoryLayouts } from '@/domain/laboratory-layout';
import {
  migrateLegacyDeviceTechnicalProfiles,
  migrateLegacyManagedDevices,
  validateManagedDeviceInventory,
  type QrPublicIdFactory,
} from '@/domain/managed-device';
import type { Laboratory, MasterDataCategoryKey, MasterDataCollection, MasterDataItem } from '@/types';
import { MASTER_DATA_CATEGORY_KEYS } from './masterData';
import { CURRENT_DB_SCHEMA_VERSION } from './dbSchema';

export type DatabaseMigrationIssueCode =
  | 'invalid-database'
  | 'malformed-storage-json'
  | 'missing-collection'
  | 'invalid-collection'
  | 'invalid-nested-collection'
  | 'unsupported-schema-version'
  | 'invalid-laboratory'
  | 'duplicate-device-id'
  | 'legacy-layout-migration-failed'
  | 'persisted-layout-integrity-failed'
  | 'managed-device-migration-failed'
  | 'managed-device-profile-migration-failed'
  | 'managed-device-integrity-failed';

export interface DatabaseMigrationIssue {
  code: DatabaseMigrationIssueCode;
  message: string;
  path?: string;
  laboratoryId?: string;
  layoutId?: string;
  deviceId?: string;
  assetId?: string;
  validationIssueCode?: string;
}

export type DatabaseNormalizationResult =
  | { ok: true; db: SeedData; changed: boolean; migratedFromVersion: number | null }
  | { ok: false; issues: DatabaseMigrationIssue[] };

export interface DatabaseNormalizationOptions {
  migratedAt: string;
  defaults?: MasterDataCollection;
  generateQrPublicId?: QrPublicIdFactory;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMasterDataItem(value: unknown, category: MasterDataCategoryKey): value is MasterDataItem {
  if (!isRecord(value) || value.category !== category || typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || !value.name.trim()) return false;
  return (value.code === undefined || typeof value.code === 'string')
    && (value.isActive === undefined || typeof value.isActive === 'boolean')
    && (value.createdAt === undefined || typeof value.createdAt === 'string')
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string');
}

function normalizeMasterDataItem(value: unknown, category: MasterDataCategoryKey): MasterDataItem | null {
  if (!isMasterDataItem(value, category)) return null;
  const code = value.code?.trim();
  return {
    id: value.id,
    category,
    name: value.name.trim(),
    ...(code ? { code } : {}),
    ...(value.isActive === undefined ? {} : { isActive: value.isActive }),
    ...(value.createdAt === undefined ? {} : { createdAt: value.createdAt }),
    ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt }),
  };
}

function normalizeMasterData(value: unknown, defaults: MasterDataCollection): MasterDataCollection {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(MASTER_DATA_CATEGORY_KEYS.map((category) => {
    const rawItems = source[category];
    if (!Array.isArray(rawItems)) return [category, defaults[category].map((item) => ({ ...item }))];
    const ids = new Set<string>();
    const items: MasterDataItem[] = [];
    rawItems.forEach((rawItem) => {
      const item = normalizeMasterDataItem(rawItem, category);
      if (!item || ids.has(item.id)) return;
      ids.add(item.id);
      items.push(item);
    });
    return [category, items];
  })) as MasterDataCollection;
}

function isLegacyDevice(value: unknown): value is { id: string; laboratoryId: string; positionCode: string; row: number; col: number } {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.laboratoryId === 'string'
    && typeof value.positionCode === 'string'
    && typeof value.row === 'number'
    && typeof value.col === 'number';
}

function stripCoordinates(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { row, col, ...device } = value;
  void row;
  void col;
  return device;
}

const ARRAY_COLLECTIONS = ['labs', 'devices', 'layouts', 'schedules', 'bookings', 'sessions', 'journals', 'incidents', 'workOrders', 'assets', 'loans', 'calendarEvents', 'notifications', 'users', 'auditLogs'] as const;

function collectionIssues(value: Record<string, unknown>, requireLayouts: boolean): DatabaseMigrationIssue[] {
  const issues: DatabaseMigrationIssue[] = [];
  for (const key of ARRAY_COLLECTIONS) {
    if (!requireLayouts && key === 'layouts') continue;
    if (!(key in value)) issues.push({ code: 'missing-collection', message: `Koleksi ${key} wajib tersedia.`, path: key });
    else if (!Array.isArray(value[key])) issues.push({ code: 'invalid-collection', message: `Koleksi ${key} harus berupa array.`, path: key });
  }
  if (!isRecord(value.masterData)) issues.push({ code: 'invalid-collection', message: 'Koleksi masterData harus berupa objek.', path: 'masterData' });
  for (const key of ['stock', 'maintenance'] as const) {
    if (!isRecord(value[key])) { issues.push({ code: 'invalid-collection', message: `Koleksi ${key} harus berupa objek.`, path: key }); continue; }
  }
  if (isRecord(value.stock)) for (const key of ['items', 'transactions']) if (!Array.isArray(value.stock[key])) issues.push({ code: 'invalid-nested-collection', message: `Koleksi stock.${key} harus berupa array.`, path: `stock.${key}` });
  if (isRecord(value.maintenance)) for (const key of ['plans', 'executions']) if (!Array.isArray(value.maintenance[key])) issues.push({ code: 'invalid-nested-collection', message: `Koleksi maintenance.${key} harus berupa array.`, path: `maintenance.${key}` });
  return issues;
}

function baseDatabase(value: Record<string, unknown>, masterData: MasterDataCollection, layouts: unknown[], devices: unknown[] = value.devices as unknown[]): SeedData {
  return {
    schemaVersion: CURRENT_DB_SCHEMA_VERSION, labs: value.labs as SeedData['labs'], masterData, devices: devices as SeedData['devices'], layouts: layouts as SeedData['layouts'], schedules: value.schedules as SeedData['schedules'], bookings: value.bookings as SeedData['bookings'], sessions: value.sessions as SeedData['sessions'], journals: value.journals as SeedData['journals'], incidents: value.incidents as SeedData['incidents'], workOrders: value.workOrders as SeedData['workOrders'], assets: value.assets as SeedData['assets'], stock: { items: (value.stock as Record<string, unknown>).items as SeedData['stock']['items'], transactions: (value.stock as Record<string, unknown>).transactions as SeedData['stock']['transactions'] }, loans: value.loans as SeedData['loans'], maintenance: { plans: (value.maintenance as Record<string, unknown>).plans as SeedData['maintenance']['plans'], executions: (value.maintenance as Record<string, unknown>).executions as SeedData['maintenance']['executions'] }, calendarEvents: value.calendarEvents as SeedData['calendarEvents'], notifications: value.notifications as SeedData['notifications'], users: value.users as SeedData['users'], auditLogs: value.auditLogs as SeedData['auditLogs'],
  };
}

function validateDatabase(db: SeedData): DatabaseMigrationIssue[] {
  const layoutIssues: DatabaseMigrationIssue[] = validatePersistedLaboratoryLayouts(db).issues.map((issue) => ({
    code: 'persisted-layout-integrity-failed',
    message: issue.message,
    laboratoryId: issue.laboratoryId,
    layoutId: issue.layoutId,
    deviceId: issue.deviceId,
    validationIssueCode: issue.validationIssueCode ?? issue.code,
  }));
  const deviceIssues: DatabaseMigrationIssue[] = validateManagedDeviceInventory(db).issues.map((issue) => ({
    code: 'managed-device-integrity-failed',
    message: issue.message,
    deviceId: issue.deviceId,
    assetId: issue.assetId,
    validationIssueCode: issue.code,
  }));
  return [...layoutIssues, ...deviceIssues];
}

export function normalizeDatabase(value: unknown, options: DatabaseNormalizationOptions): DatabaseNormalizationResult {
  if (!isRecord(value)) {
    return { ok: false, issues: [{ code: 'invalid-database', message: 'Database harus memiliki koleksi labs dan devices.' }] };
  }
  const rawVersion = value.schemaVersion;
  const collectionValidation = collectionIssues(value, rawVersion === 2 || rawVersion === 3 || rawVersion === CURRENT_DB_SCHEMA_VERSION);
  if (collectionValidation.length) return { ok: false, issues: collectionValidation };
  const defaults = options.defaults ?? generateMasterData();
  const masterData = normalizeMasterData(value.masterData, defaults);
  if (rawVersion !== undefined && rawVersion !== 2 && rawVersion !== 3 && rawVersion !== CURRENT_DB_SCHEMA_VERSION) {
    return { ok: false, issues: [{ code: 'unsupported-schema-version', message: 'Versi schema database tidak didukung.' }] };
  }

  if (rawVersion === CURRENT_DB_SCHEMA_VERSION) {
    if (!Array.isArray(value.layouts)) return { ok: false, issues: [{ code: 'invalid-database', message: `Database versi ${CURRENT_DB_SCHEMA_VERSION} harus memiliki koleksi layouts.` }] };
    const db = baseDatabase(value, masterData, value.layouts as unknown[]);
    const issues = validateDatabase(db);
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, db, changed: JSON.stringify(value) !== JSON.stringify(db), migratedFromVersion: null };
  }

  if (rawVersion === 3) {
    if (!Array.isArray(value.layouts)) return { ok: false, issues: [{ code: 'invalid-database', message: 'Database versi 3 harus memiliki koleksi layouts.' }] };
    const profiledDevices = migrateLegacyDeviceTechnicalProfiles(value.devices as unknown[]);
    if (!profiledDevices.ok) {
      return {
        ok: false,
        issues: profiledDevices.issues.map((issue) => ({
          code: 'managed-device-profile-migration-failed',
          message: issue.message,
          deviceId: issue.deviceId,
          validationIssueCode: issue.code,
        })),
      };
    }
    const db = baseDatabase(value, masterData, value.layouts as unknown[], profiledDevices.devices);
    const issues = validateDatabase(db);
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, db, changed: true, migratedFromVersion: 3 };
  }

  if (rawVersion === 2) {
    if (!Array.isArray(value.layouts)) return { ok: false, issues: [{ code: 'invalid-database', message: 'Database versi 2 harus memiliki koleksi layouts.' }] };
    const migratedDevices = migrateLegacyManagedDevices({
      devices: value.devices as SeedData['devices'],
      assets: value.assets as SeedData['assets'],
      generateQrPublicId: options.generateQrPublicId,
    });
    if (!migratedDevices.ok) {
      return { ok: false, issues: migratedDevices.issues.map((issue) => ({ code: 'managed-device-migration-failed', message: issue.message, deviceId: issue.deviceId, validationIssueCode: issue.code })) };
    }
    const profiledDevices = migrateLegacyDeviceTechnicalProfiles(migratedDevices.devices);
    if (!profiledDevices.ok) {
      return {
        ok: false,
        issues: profiledDevices.issues.map((issue) => ({ code: 'managed-device-profile-migration-failed', message: issue.message, deviceId: issue.deviceId, validationIssueCode: issue.code })),
      };
    }
    const db = baseDatabase(value, masterData, value.layouts as unknown[], profiledDevices.devices);
    const issues = validateDatabase(db);
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, db, changed: true, migratedFromVersion: 2 };
  }

  const legacyDevices = value.devices as unknown[];
  const legacyLabs = value.labs as unknown[];
  const deviceIds = new Set<string>();
  const issues: DatabaseMigrationIssue[] = [];
  legacyDevices.forEach((rawDevice) => {
    if (!isRecord(rawDevice) || typeof rawDevice.id !== 'string' || !rawDevice.id.trim()) {
      issues.push({ code: 'duplicate-device-id', message: 'ID perangkat legacy wajib diisi.' });
      return;
    }
    if (deviceIds.has(rawDevice.id)) issues.push({ code: 'duplicate-device-id', message: 'ID perangkat legacy tidak boleh duplikat.', deviceId: rawDevice.id });
    deviceIds.add(rawDevice.id);
  });
  if (issues.length > 0) return { ok: false, issues };

  const layouts = [];
  for (const rawLaboratory of legacyLabs) {
    if (!isRecord(rawLaboratory) || typeof rawLaboratory.id !== 'string' || typeof rawLaboratory.name !== 'string' || typeof rawLaboratory.layoutRows !== 'number' || typeof rawLaboratory.layoutCols !== 'number') {
      issues.push({ code: 'invalid-laboratory', message: 'Laboratorium legacy tidak valid.' });
      continue;
    }
    const laboratory = rawLaboratory as unknown as Laboratory;
    const devices = legacyDevices.filter((device) => isLegacyDevice(device) && device.laboratoryId === laboratory.id) as { id: string; laboratoryId: string; positionCode: string; row: number; col: number }[];
    if (legacyDevices.some((device) => isRecord(device) && device.laboratoryId === laboratory.id && !isLegacyDevice(device))) {
      issues.push({ code: 'legacy-layout-migration-failed', message: 'Perangkat legacy tidak memiliki koordinat lengkap.', laboratoryId: laboratory.id });
      continue;
    }
    const layoutId = `layout:${laboratory.id}:v1`;
    const migrated = migrateLegacyDeviceCoordinates({
      layoutId,
      laboratory,
      devices,
      name: `${laboratory.name} — Denah Aktif`,
      createdAt: options.migratedAt,
      updatedAt: options.migratedAt,
      layoutType: 'grid-classic',
      version: 1,
      status: 'active',
      isActive: true,
    });
    if (!migrated.ok) {
      migrated.issues.forEach((issue) => issues.push({ code: 'legacy-layout-migration-failed', message: issue.message, laboratoryId: laboratory.id, layoutId, deviceId: issue.deviceId, validationIssueCode: issue.code }));
    } else {
      layouts.push(migrated.layout);
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  const coordinateFreeDevices = legacyDevices.map(stripCoordinates) as SeedData['devices'];
  const migratedDevices = migrateLegacyManagedDevices({
    devices: coordinateFreeDevices,
    assets: value.assets as SeedData['assets'],
    generateQrPublicId: options.generateQrPublicId,
  });
  if (!migratedDevices.ok) {
    return { ok: false, issues: migratedDevices.issues.map((issue) => ({ code: 'managed-device-migration-failed', message: issue.message, deviceId: issue.deviceId, validationIssueCode: issue.code })) };
  }
  const profiledDevices = migrateLegacyDeviceTechnicalProfiles(migratedDevices.devices);
  if (!profiledDevices.ok) {
    return {
      ok: false,
      issues: profiledDevices.issues.map((issue) => ({ code: 'managed-device-profile-migration-failed', message: issue.message, deviceId: issue.deviceId, validationIssueCode: issue.code })),
    };
  }
  const db = baseDatabase(value, masterData, layouts, profiledDevices.devices);
  const integrityIssues = validateDatabase(db);
  if (integrityIssues.length > 0) return { ok: false, issues: integrityIssues };
  return { ok: true, db, changed: true, migratedFromVersion: 1 };
}
