import { generateMasterData, type SeedData } from '@/data/seed';
import { migrateLegacyDeviceCoordinates, validatePersistedLaboratoryLayouts } from '@/domain/laboratory-layout';
import type { Laboratory, MasterDataCategoryKey, MasterDataCollection, MasterDataItem } from '@/types';
import { MASTER_DATA_CATEGORY_KEYS } from './masterData';
import { CURRENT_DB_SCHEMA_VERSION } from './dbSchema';

export type DatabaseMigrationIssueCode =
  | 'invalid-database'
  | 'unsupported-schema-version'
  | 'invalid-laboratory'
  | 'duplicate-device-id'
  | 'legacy-layout-migration-failed'
  | 'persisted-layout-integrity-failed';

export interface DatabaseMigrationIssue {
  code: DatabaseMigrationIssueCode;
  message: string;
  laboratoryId?: string;
  layoutId?: string;
  deviceId?: string;
  validationIssueCode?: string;
}

export type DatabaseNormalizationResult =
  | { ok: true; db: SeedData; changed: boolean; migratedFromVersion: number | null }
  | { ok: false; issues: DatabaseMigrationIssue[] };

export interface DatabaseNormalizationOptions {
  migratedAt: string;
  defaults?: MasterDataCollection;
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

function baseDatabase(value: Record<string, unknown>, masterData: MasterDataCollection): SeedData {
  return { ...value, schemaVersion: CURRENT_DB_SCHEMA_VERSION, masterData } as SeedData;
}

function validateDatabase(db: SeedData): DatabaseMigrationIssue[] {
  return validatePersistedLaboratoryLayouts(db).issues.map((issue) => ({
    code: 'persisted-layout-integrity-failed',
    message: issue.message,
    laboratoryId: issue.laboratoryId,
    layoutId: issue.layoutId,
    deviceId: issue.deviceId,
    validationIssueCode: issue.validationIssueCode ?? issue.code,
  }));
}

export function normalizeDatabase(value: unknown, options: DatabaseNormalizationOptions): DatabaseNormalizationResult {
  if (!isRecord(value) || !Array.isArray(value.labs) || !Array.isArray(value.devices)) {
    return { ok: false, issues: [{ code: 'invalid-database', message: 'Database harus memiliki koleksi labs dan devices.' }] };
  }
  const defaults = options.defaults ?? generateMasterData();
  const masterData = normalizeMasterData(value.masterData, defaults);
  const rawVersion = value.schemaVersion;
  if (rawVersion !== undefined && rawVersion !== CURRENT_DB_SCHEMA_VERSION) {
    return { ok: false, issues: [{ code: 'unsupported-schema-version', message: 'Versi schema database tidak didukung.' }] };
  }

  if (rawVersion === CURRENT_DB_SCHEMA_VERSION) {
    if (!Array.isArray(value.layouts)) return { ok: false, issues: [{ code: 'invalid-database', message: 'Database versi 2 harus memiliki koleksi layouts.' }] };
    const db = baseDatabase(value, masterData);
    const issues = validateDatabase(db);
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, db, changed: JSON.stringify(value) !== JSON.stringify(db), migratedFromVersion: null };
  }

  const deviceIds = new Set<string>();
  const issues: DatabaseMigrationIssue[] = [];
  value.devices.forEach((rawDevice) => {
    if (!isRecord(rawDevice) || typeof rawDevice.id !== 'string' || !rawDevice.id.trim()) {
      issues.push({ code: 'duplicate-device-id', message: 'ID perangkat legacy wajib diisi.' });
      return;
    }
    if (deviceIds.has(rawDevice.id)) issues.push({ code: 'duplicate-device-id', message: 'ID perangkat legacy tidak boleh duplikat.', deviceId: rawDevice.id });
    deviceIds.add(rawDevice.id);
  });
  if (issues.length > 0) return { ok: false, issues };

  const layouts = [];
  for (const rawLaboratory of value.labs) {
    if (!isRecord(rawLaboratory) || typeof rawLaboratory.id !== 'string' || typeof rawLaboratory.name !== 'string' || typeof rawLaboratory.layoutRows !== 'number' || typeof rawLaboratory.layoutCols !== 'number') {
      issues.push({ code: 'invalid-laboratory', message: 'Laboratorium legacy tidak valid.' });
      continue;
    }
    const laboratory = rawLaboratory as unknown as Laboratory;
    const devices = value.devices.filter((device) => isLegacyDevice(device) && device.laboratoryId === laboratory.id) as { id: string; laboratoryId: string; positionCode: string; row: number; col: number }[];
    if (value.devices.some((device) => isRecord(device) && device.laboratoryId === laboratory.id && !isLegacyDevice(device))) {
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
  const db = { ...baseDatabase(value, masterData), devices: value.devices.map(stripCoordinates), layouts } as SeedData;
  const integrityIssues = validateDatabase(db);
  if (integrityIssues.length > 0) return { ok: false, issues: integrityIssues };
  return { ok: true, db, changed: true, migratedFromVersion: 1 };
}
