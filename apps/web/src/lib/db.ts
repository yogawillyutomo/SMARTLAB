import type { SeedData } from '@/data/seed';
import { generateSeedData } from '@/data/seed';
import { STORAGE_KEYS, getStoredVersion, readStorage, setStoredVersion, writeStorage } from './storage';

// App database stored in localStorage as a single blob for simplicity of backup/restore
export type AppDB = SeedData;

const DB_KEY = 'db';

export function loadDB(): AppDB {
  const existing = readStorage<AppDB | null>(DB_KEY, null);
  if (existing) return existing;

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
