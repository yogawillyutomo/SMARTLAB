import { removeSessionStorage, removeStorage, STORAGE_KEYS } from '@/lib/storage';

/** Removes only the obsolete demo-auth key; AppDB and UI preferences are untouched. */
export function clearLegacyAuthStorage(): void {
  removeStorage(STORAGE_KEYS.AUTH);
  removeSessionStorage(STORAGE_KEYS.AUTH);
}
