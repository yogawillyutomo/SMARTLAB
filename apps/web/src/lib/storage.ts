const PREFIX = 'smartlab_pplg_';
const VERSION_KEY = `${PREFIX}version`;
const DATA_KEY = `${PREFIX}data`;
const CURRENT_VERSION = '1.0.0';

function readFromStorage<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(`${PREFIX}${key}`);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeToStorage<T>(storage: Storage, key: string, value: T): void {
  try {
    storage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
  } catch (e) {
    console.error('Failed to write storage', e);
  }
}

function removeFromStorage(storage: Storage, key: string): void {
  try {
    storage.removeItem(`${PREFIX}${key}`);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function readStorage<T>(key: string, fallback: T): T {
  return readFromStorage(localStorage, key, fallback);
}

export function writeStorage<T>(key: string, value: T): void {
  writeToStorage(localStorage, key, value);
}

export function readSessionStorage<T>(key: string, fallback: T): T {
  return readFromStorage(sessionStorage, key, fallback);
}

export function writeSessionStorage<T>(key: string, value: T): void {
  writeToStorage(sessionStorage, key, value);
}

export function removeStorage(key: string): void {
  removeFromStorage(localStorage, key);
}

export function removeSessionStorage(key: string): void {
  removeFromStorage(sessionStorage, key);
}

export function clearAllStorage(): void {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}

export function getStoredVersion(): string | null {
  return localStorage.getItem(VERSION_KEY);
}

export function setStoredVersion(): void {
  localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
}

export function getDataRaw(): string | null {
  return localStorage.getItem(DATA_KEY);
}

export function setDataRaw(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    localStorage.setItem(DATA_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export const STORAGE_KEYS = {
  DATA: DATA_KEY,
  VERSION: VERSION_KEY,
  AUTH: 'auth',
  UI: 'ui',
  ROLE_PERMS: 'role_perms',
} as const;
