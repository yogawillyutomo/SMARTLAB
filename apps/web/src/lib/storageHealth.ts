import type { DatabaseLoadResult, DatabaseSaveResult } from './db';

export interface StorageHealthState {
  warnings: string[];
  versionWriteOk: boolean;
}

export function storageHealthOf(result: DatabaseLoadResult): StorageHealthState {
  return result.ok
    ? { warnings: result.warnings, versionWriteOk: result.versionWriteOk }
    : { warnings: [], versionWriteOk: true };
}

export function storageHealthOfSave(result: DatabaseSaveResult): StorageHealthState {
  return result.ok
    ? { warnings: result.warnings, versionWriteOk: result.versionWriteOk }
    : { warnings: [], versionWriteOk: true };
}
