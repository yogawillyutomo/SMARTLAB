import { generateSeedData, type SeedData } from '@/data/seed';
import { normalizeDatabase, type DatabaseMigrationIssue, type DatabaseNormalizationResult } from './dbMigrations';
import { CURRENT_STORAGE_VERSION } from './dbSchema';
import { STORAGE_KEYS, getStoredVersion, readStorage, setStoredVersion, writeStorage } from './storage';

export type AppDB = SeedData;

export type DatabaseSaveResult =
  | { ok: true; db: AppDB }
  | { ok: false; error: string; issues: DatabaseMigrationIssue[] };

const DB_KEY = 'db';

function currentTimestamp(): string {
  return new Date().toISOString();
}

function saveNormalization(result: DatabaseNormalizationResult): DatabaseSaveResult {
  if (!result.ok) return { ok: false, error: 'Database tidak valid dan tidak dapat disimpan.', issues: result.issues };
  writeStorage(DB_KEY, result.db);
  setStoredVersion();
  return { ok: true, db: result.db };
}

export function normalizeDB(value: unknown, migratedAt = currentTimestamp()): DatabaseNormalizationResult {
  return normalizeDatabase(value, { migratedAt });
}

export function loadDB(): AppDB {
  const existing = readStorage<unknown>(DB_KEY, null);
  if (existing !== null) {
    const normalized = normalizeDB(existing);
    if (normalized.ok) {
      if (normalized.changed) {
        const saved = saveNormalization(normalized);
        if (saved.ok) return saved.db;
      }
      if (getStoredVersion() !== CURRENT_STORAGE_VERSION) setStoredVersion();
      return normalized.db;
    }
    console.error('Migrasi database SmartLab gagal. Data localStorage asli dipertahankan.', normalized.issues);
    return generateSeedData();
  }
  const seed = generateSeedData();
  const saved = saveDB(seed);
  if (!saved.ok) throw new Error('Seed SmartLab tidak valid.');
  return saved.db;
}

export function saveDB(db: AppDB): DatabaseSaveResult {
  const normalized = normalizeDB(db);
  return saveNormalization(normalized);
}

export function resetDB(): AppDB {
  const saved = saveDB(generateSeedData());
  if (!saved.ok) throw new Error('Reset database SmartLab gagal.');
  return saved.db;
}

export function getDB(): AppDB {
  return loadDB();
}

export function updateDB(mutator: (db: AppDB) => void): AppDB {
  const db = loadDB();
  mutator(db);
  const saved = saveDB(db);
  if (!saved.ok) throw new Error(saved.error);
  return saved.db;
}

export { STORAGE_KEYS, getStoredVersion, setStoredVersion };

export function delay(ms = 250): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
