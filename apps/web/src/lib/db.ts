import { generateSeedData, type SeedData } from '@/data/seed';
import { normalizeDatabase, type DatabaseMigrationIssue, type DatabaseNormalizationResult } from './dbMigrations';
import { CURRENT_STORAGE_VERSION } from './dbSchema';
import { STORAGE_KEYS, readStorageJSON, readStoredVersion, setStoredVersion, writeStorage } from './storage';

export type AppDB = SeedData;
export type { DatabaseMigrationIssue } from './dbMigrations';
export const RECOVERY_WRITE_ERROR = 'Database asli sedang dipertahankan karena migrasi gagal. Impor backup yang valid atau lakukan reset database sebelum menyimpan perubahan.';
export type DatabaseSaveResult =
  | { ok: true; db: AppDB; versionWriteOk: boolean; warnings: string[] }
  | { ok: false; error: string; issues: DatabaseMigrationIssue[]; storageError?: unknown };
export type DatabaseLoadResult =
  | { ok: true; db: AppDB; mode: 'persisted'; migrated: boolean; warnings: string[]; versionWriteOk: boolean }
  | { ok: false; db: AppDB; mode: 'recovery'; issues: DatabaseMigrationIssue[]; rawPreserved: true };

const DB_KEY = 'db';
function currentTimestamp(): string { return new Date().toISOString(); }
function storageFailure(error: unknown): DatabaseSaveResult { return { ok: false, error: 'Database tidak dapat disimpan ke penyimpanan browser.', issues: [], storageError: error }; }

export function normalizeDB(value: unknown, migratedAt = currentTimestamp()): DatabaseNormalizationResult {
  return normalizeDatabase(value, { migratedAt });
}

export function loadDB(): DatabaseLoadResult {
  const stored = readStorageJSON<unknown>(DB_KEY);
  if (!stored.ok) {
    const issue: DatabaseMigrationIssue = { code: 'malformed-storage-json', message: stored.status === 'malformed' ? 'Database lokal tidak dapat dibaca karena JSON rusak.' : 'Penyimpanan browser tidak dapat dibaca.', path: 'smartlab_pplg_db' };
    return { ok: false, db: generateSeedData(), mode: 'recovery', issues: [issue], rawPreserved: true };
  }
  if (stored.status === 'missing') {
    const db = generateSeedData();
    const saved = persistDB(db, { writeVersion: true, allowRecoveryReplace: true });
    if (!saved.ok) throw new Error(saved.error);
    return { ok: true, db: saved.db, mode: 'persisted', migrated: false, warnings: saved.warnings, versionWriteOk: saved.versionWriteOk };
  }
  const normalized = normalizeDB(stored.value);
  if (!normalized.ok) {
    console.error('Migrasi database SmartLab gagal. Data localStorage asli dipertahankan.', normalized.issues);
    return { ok: false, db: generateSeedData(), mode: 'recovery', issues: normalized.issues, rawPreserved: true };
  }
  if (normalized.changed) {
    const saved = persistDB(normalized.db, { writeVersion: true, allowRecoveryReplace: true });
    if (!saved.ok) return { ok: false, db: normalized.db, mode: 'recovery', issues: saved.issues, rawPreserved: true };
    return {
      ok: true,
      db: saved.db,
      mode: 'persisted',
      migrated: normalized.migratedFromVersion !== null,
      warnings: saved.warnings,
      versionWriteOk: saved.versionWriteOk,
    };
  } else {
    const version = readStoredVersion();
    if (!version.ok) return { ok: true, db: normalized.db, mode: 'persisted', migrated: false, warnings: ['Versi penyimpanan tidak dapat dibaca.'], versionWriteOk: false };
    if (version.value !== CURRENT_STORAGE_VERSION) {
      const repaired = setStoredVersion();
      return { ok: true, db: normalized.db, mode: 'persisted', migrated: false, warnings: repaired.ok ? [] : ['Versi penyimpanan tidak dapat diperbarui.'], versionWriteOk: repaired.ok };
    }
  }
  return { ok: true, db: normalized.db, mode: 'persisted', migrated: normalized.migratedFromVersion !== null, warnings: [], versionWriteOk: true };
}

function rawIsRecovery(): DatabaseMigrationIssue[] | null {
  const stored = readStorageJSON<unknown>(DB_KEY);
  if (!stored.ok) return [{ code: 'malformed-storage-json', message: stored.status === 'malformed' ? 'Database lokal tidak dapat dibaca karena JSON rusak.' : 'Penyimpanan browser tidak dapat dibaca.', path: 'smartlab_pplg_db' }];
  if (stored.status === 'missing') return null;
  const normalized = normalizeDB(stored.value);
  return normalized.ok ? null : normalized.issues;
}

export function persistDB(db: AppDB, options: { allowRecoveryReplace?: boolean; writeVersion?: boolean } = {}): DatabaseSaveResult {
  const normalized = normalizeDB(db);
  if (!normalized.ok) return { ok: false, error: 'Database tidak valid dan tidak dapat disimpan.', issues: normalized.issues };
  const recoveryIssues = options.allowRecoveryReplace ? null : rawIsRecovery();
  if (recoveryIssues) return { ok: false, error: RECOVERY_WRITE_ERROR, issues: recoveryIssues };
  const write = writeStorage(DB_KEY, normalized.db);
  if (!write.ok) return storageFailure(write.error);
  if (!options.writeVersion) return { ok: true, db: normalized.db, versionWriteOk: true, warnings: [] };
  const version = setStoredVersion();
  return version.ok
    ? { ok: true, db: normalized.db, versionWriteOk: true, warnings: [] }
    : { ok: true, db: normalized.db, versionWriteOk: false, warnings: ['Database tersimpan, tetapi versi penyimpanan belum dapat diperbarui.'] };
}

export function saveDB(db: AppDB): DatabaseSaveResult { return persistDB(db); }
export function resetDB(): DatabaseSaveResult { return persistDB(generateSeedData(), { allowRecoveryReplace: true, writeVersion: true }); }
export function getDB(): AppDB {
  const result = loadDB();
  if (!result.ok) throw new Error(RECOVERY_WRITE_ERROR);
  return result.db;
}
export function updateDB(mutator: (db: AppDB) => void): AppDB {
  const loaded = loadDB();
  if (!loaded.ok) throw new Error(RECOVERY_WRITE_ERROR);
  const next = JSON.parse(JSON.stringify(loaded.db)) as AppDB;
  mutator(next);
  const saved = saveDB(next);
  if (!saved.ok) throw new Error(saved.error);
  return saved.db;
}
export { STORAGE_KEYS, readStoredVersion, setStoredVersion };
export function delay(ms = 250): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
