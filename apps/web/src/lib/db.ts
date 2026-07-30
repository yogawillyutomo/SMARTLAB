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

function normalizeMasterDataItem(value: unknown, category: MasterDataCategoryKey): MasterDataItem | null {
  if (!isMasterDataItem(value, category)) return null;

  const normalized: MasterDataItem = {
    id: value.id,
    category,
    name: value.name.trim(),
    isActive: value.isActive,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  const code = value.code?.trim();
  if (code) normalized.code = code;
  return normalized;
}

function normalizeMasterData(value: unknown, defaults: MasterDataCollection): MasterDataCollection {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(MASTER_DATA_CATEGORY_KEYS.map((category) => {
    const rawItems = source[category];
    if (!Array.isArray(rawItems)) return [category, defaults[category].map((item) => ({ ...item }))];
    const ids = new Set<string>();
    const items: MasterDataItem[] = [];
    for (const rawItem of rawItems) {
      const item = normalizeMasterDataItem(rawItem, category);
      if (!item || ids.has(item.id)) continue;
      ids.add(item.id);
      items.push(item);
    }
    return [category, items];
  })) as MasterDataCollection;
}

function masterDataItemMatches(value: unknown, item: MasterDataItem): boolean {
  return isRecord(value)
    && value.id === item.id
    && value.category === item.category
    && value.name === item.name
    && value.code === item.code
    && value.isActive === item.isActive
    && value.createdAt === item.createdAt
    && value.updatedAt === item.updatedAt;
}

function needsMasterDataNormalization(value: unknown, normalized: MasterDataCollection): boolean {
  if (!isRecord(value)) return true;
  return MASTER_DATA_CATEGORY_KEYS.some((category) => {
    const rawItems = value[category];
    return !Array.isArray(rawItems)
      || rawItems.length !== normalized[category].length
      || rawItems.some((item, index) => !masterDataItemMatches(item, normalized[category][index]));
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
    if (needsMasterDataNormalization(existing.masterData, normalized.masterData)) writeStorage(DB_KEY, normalized);
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
