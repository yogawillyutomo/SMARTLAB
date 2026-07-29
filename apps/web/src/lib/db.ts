import type { SeedData } from '@/data/seed';
import { generateMasterData, generateSeedData } from '@/data/seed';
import { MASTER_DATA_CATEGORY_KEYS } from './masterData';
import type { MasterDataCategoryKey, MasterDataCollection, MasterDataItem } from '@/types';
import { STORAGE_KEYS, getStoredVersion, readStorage, setStoredVersion, writeStorage } from './storage';

// App database stored in localStorage as a single blob for simplicity of backup/restore
export type AppDB = SeedData;

const DB_KEY = 'db';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMasterDataItem(value: unknown, category: MasterDataCategoryKey): value is MasterDataItem {
  if (!isRecord(value) || value.category !== category || typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || !value.name.trim()) return false;
  if (value.code !== undefined && typeof value.code !== 'string') return false;
  if (value.isActive !== undefined && typeof value.isActive !== 'boolean') return false;
  if (value.createdAt !== undefined && typeof value.createdAt !== 'string') return false;
  if (value.updatedAt !== undefined && typeof value.updatedAt !== 'string') return false;
  return true;
}

function normalizeMasterData(value: unknown, defaults: MasterDataCollection): MasterDataCollection {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(MASTER_DATA_CATEGORY_KEYS.map((category) => {
    const rawItems = source[category];
    if (!Array.isArray(rawItems)) return [category, defaults[category].map((item) => ({ ...item }))];
    const validItems = rawItems.filter((item): item is MasterDataItem => isMasterDataItem(item, category));
    if (validItems.length !== rawItems.length) return [category, defaults[category].map((item) => ({ ...item }))];
    return [category, validItems.map((item) => {
      const normalized: MasterDataItem = {
        id: item.id,
        category,
        name: item.name.trim(),
        isActive: item.isActive,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
      const code = item.code?.trim();
      if (code) normalized.code = code;
      return normalized;
    })];
  })) as MasterDataCollection;
}

function needsMasterDataNormalization(value: unknown): boolean {
  if (!isRecord(value)) return true;
  return MASTER_DATA_CATEGORY_KEYS.some((category) => {
    const rawItems = value[category];
    return !Array.isArray(rawItems) || rawItems.some((item) => !isMasterDataItem(item, category));
  });
}

export function normalizeDB(value: unknown, defaults = generateMasterData()): AppDB {
  if (!isRecord(value)) return generateSeedData();
  return { ...value, masterData: normalizeMasterData(value.masterData, defaults) } as AppDB;
}

export function loadDB(): AppDB {
  const existing = readStorage<unknown>(DB_KEY, null);
  if (isRecord(existing)) {
    const defaults = generateMasterData();
    const normalized = normalizeDB(existing, defaults);
    if (needsMasterDataNormalization(existing.masterData)) writeStorage(DB_KEY, normalized);
    return normalized;
  }

  const seed = generateSeedData();
  writeStorage(DB_KEY, seed);
  setStoredVersion();
  return seed;
}

export function saveDB(db: AppDB): void {
  writeStorage(DB_KEY, db);
}

export function resetDB(): AppDB {
  const seed = generateSeedData();
  writeStorage(DB_KEY, seed);
  setStoredVersion();
  return seed;
}

export function getDB(): AppDB {
  return loadDB();
}

export function updateDB(mutator: (db: AppDB) => void): AppDB {
  const db = loadDB();
  mutator(db);
  saveDB(db);
  return db;
}

// Re-export storage keys for convenience
export { STORAGE_KEYS, getStoredVersion, setStoredVersion };

// Simulated latency so loading states are testable
export function delay(ms = 250): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
