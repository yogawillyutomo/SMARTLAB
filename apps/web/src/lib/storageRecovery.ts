import { clearAllStorage } from '@/utils';

export function canClearAllStorage(recoveryActive: boolean): boolean {
  return !recoveryActive;
}

export function clearAllStorageIfAllowed(recoveryActive: boolean): boolean {
  if (!canClearAllStorage(recoveryActive)) return false;
  clearAllStorage();
  return true;
}
