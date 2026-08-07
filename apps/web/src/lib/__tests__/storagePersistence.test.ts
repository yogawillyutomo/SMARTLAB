import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSeedData } from '@/data/seed';
import { loadDB, persistDB, resetDB, updateDB } from '@/lib/db';
import { STORAGE_KEYS, readStorageJSON, readStoredVersion } from '@/lib/storage';
import { clearAllStorageIfAllowed, canClearAllStorage } from '@/lib/storageRecovery';
import { mergeStorageHealthAfterSave, storageHealthOf } from '@/lib/storageHealth';

const DB_KEY = 'smartlab_pplg_db';

class ControlledStorage implements Storage {
  private readonly values = new Map<string, string>();
  readonly readFailures = new Set<string>();
  readonly writeFailures = new Set<string>();
  readonly writeAttempts = new Map<string, number>();
  readonly writes = new Map<string, number>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null {
    if (this.readFailures.has(key)) throw new Error(`read failed: ${key}`);
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    this.writeAttempts.set(key, (this.writeAttempts.get(key) ?? 0) + 1);
    if (this.writeFailures.has(key)) throw new Error(`write failed: ${key}`);
    this.values.set(key, value);
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
  }
  seed(key: string, value: string): void { this.values.set(key, value); }
  writesFor(key: string): number { return this.writes.get(key) ?? 0; }
  attemptsFor(key: string): number { return this.writeAttempts.get(key) ?? 0; }
  resetCounts(): void { this.writes.clear(); this.writeAttempts.clear(); }
}

let storage: ControlledStorage;

beforeEach(() => {
  storage = new ControlledStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seedCurrentDatabase(version = '2.0.0') {
  storage.seed(DB_KEY, JSON.stringify(generateSeedData()));
  if (version) storage.seed(STORAGE_KEYS.VERSION, version);
  storage.resetCounts();
}

function legacyDatabase() {
  const db = generateSeedData();
  const placements = new Map(db.layouts.flatMap((layout) => layout.elements
    .filter((element) => element.referenceId)
    .map((element) => [element.referenceId!, element])));
  const legacy = JSON.parse(JSON.stringify(db)) as Record<string, unknown>;
  delete legacy.schemaVersion;
  delete legacy.layouts;
  legacy.devices = db.devices.map((device) => {
    const element = placements.get(device.id)!;
    return { ...device, row: element.row, col: element.column };
  });
  return legacy;
}

describe('storage read and version repair contracts', () => {
  it('returns exact read-failed states when database or version reads throw', () => {
    storage.readFailures.add(DB_KEY);
    expect(readStorageJSON('db')).toMatchObject({ ok: false, status: 'read-failed', raw: null });
    storage.readFailures.delete(DB_KEY);
    storage.readFailures.add(STORAGE_KEYS.VERSION);
    expect(readStoredVersion()).toMatchObject({ ok: false, status: 'read-failed' });
  });

  it('treats database read failure as recovery and never as missing storage', () => {
    storage.readFailures.add(DB_KEY);
    const loaded = loadDB();
    expect(loaded).toMatchObject({ ok: false, mode: 'recovery', rawPreserved: true });
    expect(storage.writesFor(DB_KEY)).toBe(0);
    expect(storage.writesFor(STORAGE_KEYS.VERSION)).toBe(0);
  });

  it('keeps a valid database usable when reading the version key fails', () => {
    seedCurrentDatabase();
    storage.readFailures.add(STORAGE_KEYS.VERSION);
    const loaded = loadDB();
    expect(loaded).toMatchObject({ ok: true, mode: 'persisted', versionWriteOk: false, warnings: ['Versi penyimpanan tidak dapat dibaca.'] });
    expect(storage.writesFor(DB_KEY)).toBe(0);
  });

  it('does not write either key for a current version', () => {
    seedCurrentDatabase();
    expect(loadDB()).toMatchObject({ ok: true, versionWriteOk: true, warnings: [] });
    expect(storage.writesFor(DB_KEY)).toBe(0);
    expect(storage.writesFor(STORAGE_KEYS.VERSION)).toBe(0);
  });

  it('repairs stale and missing versions without rewriting the database', () => {
    seedCurrentDatabase('1.0.0');
    const stale = loadDB();
    expect(stale).toMatchObject({ ok: true, versionWriteOk: true, warnings: [] });
    expect(storage.writesFor(DB_KEY)).toBe(0);
    expect(storage.writesFor(STORAGE_KEYS.VERSION)).toBe(1);

    storage = new ControlledStorage();
    vi.stubGlobal('localStorage', storage);
    seedCurrentDatabase('');
    const missing = loadDB();
    expect(missing).toMatchObject({ ok: true, versionWriteOk: true, warnings: [] });
    expect(storage.writesFor(DB_KEY)).toBe(0);
    expect(storage.writesFor(STORAGE_KEYS.VERSION)).toBe(1);
  });

  it('reports and retries a failed version repair without rewriting the database', () => {
    seedCurrentDatabase('1.0.0');
    storage.writeFailures.add(STORAGE_KEYS.VERSION);
    const first = loadDB();
    const second = loadDB();
    expect(first).toMatchObject({ ok: true, mode: 'persisted', versionWriteOk: false, warnings: ['Versi penyimpanan tidak dapat diperbarui.'] });
    expect(second).toMatchObject({ ok: true, mode: 'persisted', versionWriteOk: false });
    expect(storage.writesFor(DB_KEY)).toBe(0);
    expect(storage.attemptsFor(STORAGE_KEYS.VERSION)).toBe(2);
  });

  it('preserves migration version warnings and writes the migrated database exactly once', () => {
    storage.seed(DB_KEY, JSON.stringify(legacyDatabase()));
    storage.writeFailures.add(STORAGE_KEYS.VERSION);
    const loaded = loadDB();
    expect(loaded).toMatchObject({
      ok: true,
      mode: 'persisted',
      migrated: true,
      versionWriteOk: false,
      warnings: ['Database tersimpan, tetapi versi penyimpanan belum dapat diperbarui.'],
    });
    expect(storage.writesFor(DB_KEY)).toBe(1);
    expect(storage.attemptsFor(STORAGE_KEYS.VERSION)).toBe(1);
  });
});

describe('recovery protection and observable storage health', () => {
  it('preserves malformed raw JSON byte-for-byte and blocks ordinary persistence and updates', () => {
    const raw = '{malformed database';
    storage.seed(DB_KEY, raw);
    expect(loadDB()).toMatchObject({ ok: false, mode: 'recovery', rawPreserved: true });
    expect(persistDB(generateSeedData())).toMatchObject({ ok: false });
    expect(() => updateDB(() => undefined)).toThrow();
    expect(storage.getItem(DB_KEY)).toBe(raw);
    expect(storage.writesFor(DB_KEY)).toBe(0);
  });

  it('blocks direct clear-all handling during recovery and permits only explicit replacement exits', () => {
    const raw = '{malformed database';
    storage.seed(DB_KEY, raw);
    expect(canClearAllStorage(true)).toBe(false);
    expect(clearAllStorageIfAllowed(true)).toBe(false);
    expect(storage.getItem(DB_KEY)).toBe(raw);

    expect(persistDB(generateSeedData(), { allowRecoveryReplace: true, writeVersion: true })).toMatchObject({ ok: true });
    expect(loadDB()).toMatchObject({ ok: true, mode: 'persisted' });

    storage.seed(DB_KEY, raw);
    expect(resetDB()).toMatchObject({ ok: true });
    expect(loadDB()).toMatchObject({ ok: true, mode: 'persisted' });
  });

  it('maps only non-blocking load warnings into provider storage health and clears them after repair', () => {
    const clean = loadDB();
    expect(storageHealthOf(clean)).toEqual({ warnings: [], versionWriteOk: true });

    seedCurrentDatabase();
    storage.readFailures.add(STORAGE_KEYS.VERSION);
    const readFailure = loadDB();
    expect(storageHealthOf(readFailure)).toEqual({ warnings: ['Versi penyimpanan tidak dapat dibaca.'], versionWriteOk: false });

    storage.readFailures.delete(STORAGE_KEYS.VERSION);
    storage.seed(STORAGE_KEYS.VERSION, '1.0.0');
    storage.writeFailures.add(STORAGE_KEYS.VERSION);
    const repairFailure = loadDB();
    expect(storageHealthOf(repairFailure)).toEqual({ warnings: ['Versi penyimpanan tidak dapat diperbarui.'], versionWriteOk: false });

    storage.writeFailures.delete(STORAGE_KEYS.VERSION);
    const repaired = loadDB();
    expect(storageHealthOf(repaired)).toEqual({ warnings: [], versionWriteOk: true });

    storage.seed(DB_KEY, '{broken');
    expect(storageHealthOf(loadDB())).toEqual({ warnings: [], versionWriteOk: true });
  });
});

describe('ordinary-save storage health lifecycle', () => {
  it('preserves a version read warning through an ordinary successful save without writing the version key', () => {
    seedCurrentDatabase();
    storage.readFailures.add(STORAGE_KEYS.VERSION);
    const initial = storageHealthOf(loadDB());
    storage.readFailures.delete(STORAGE_KEYS.VERSION);
    const saved = persistDB(generateSeedData());
    const next = mergeStorageHealthAfterSave(initial, saved, false);
    expect(saved.ok).toBe(true);
    expect(storage.writesFor(DB_KEY)).toBe(1);
    expect(storage.writesFor(STORAGE_KEYS.VERSION)).toBe(0);
    expect(next).toBe(initial);
    expect(next).toEqual({ warnings: ['Versi penyimpanan tidak dapat dibaca.'], versionWriteOk: false });
  });

  it('preserves a failed stale-version repair warning through an ordinary save, then clears it after a successful refresh', () => {
    seedCurrentDatabase('1.0.0');
    storage.writeFailures.add(STORAGE_KEYS.VERSION);
    const initial = storageHealthOf(loadDB());
    storage.resetCounts();
    const saved = persistDB(generateSeedData());
    const afterSave = mergeStorageHealthAfterSave(initial, saved, false);
    expect(afterSave).toBe(initial);
    expect(storage.writesFor(DB_KEY)).toBe(1);
    expect(storage.attemptsFor(STORAGE_KEYS.VERSION)).toBe(0);

    storage.writeFailures.delete(STORAGE_KEYS.VERSION);
    storage.resetCounts();
    const refreshed = loadDB();
    expect(refreshed).toMatchObject({ ok: true, versionWriteOk: true, warnings: [] });
    expect(storage.writesFor(DB_KEY)).toBe(0);
    expect(storage.writesFor(STORAGE_KEYS.VERSION)).toBe(1);
    expect(storageHealthOf(refreshed)).toEqual({ warnings: [], versionWriteOk: true });
  });

  it('keeps clean health on an ordinary save and preserves both DB and warning state when that save fails', () => {
    seedCurrentDatabase();
    const healthy = storageHealthOf(loadDB());
    const successful = persistDB(generateSeedData());
    expect(mergeStorageHealthAfterSave(healthy, successful, false)).toBe(healthy);
    expect(storage.writesFor(STORAGE_KEYS.VERSION)).toBe(0);

    const warning = { warnings: ['Versi penyimpanan tidak dapat diperbarui.'], versionWriteOk: false };
    storage.writeFailures.add(DB_KEY);
    const beforeRaw = storage.getItem(DB_KEY);
    const failed = persistDB(generateSeedData());
    expect(failed.ok).toBe(false);
    expect(storage.getItem(DB_KEY)).toBe(beforeRaw);
    expect(mergeStorageHealthAfterSave(warning, failed, false)).toBe(warning);
  });
});
