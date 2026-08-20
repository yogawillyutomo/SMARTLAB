import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSeedData } from '@/data/seed';
import { loadDB } from '@/lib/db';
import { normalizeDatabase } from '@/lib/dbMigrations';
import { CURRENT_DB_SCHEMA_VERSION, CURRENT_STORAGE_VERSION } from '@/lib/dbSchema';
import { STORAGE_KEYS } from '@/lib/storage';
import type { Device } from '@/types';

const DB_KEY = 'smartlab_pplg_db';
const MIGRATED_AT = '2026-08-19T08:00:00.000Z';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  readonly writes = new Map<string, number>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
  }
  seed(key: string, value: string): void { this.values.set(key, value); }
  writesFor(key: string): number { return this.writes.get(key) ?? 0; }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  let sequence = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `00000000-0000-4000-8000-${String(sequence += 1).padStart(12, '0')}`,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function withoutManagedIdentity(device: Device) {
  const { deviceType, lifecycleStatus, qrPublicId, assetId, ...legacy } = device;
  void deviceType;
  void lifecycleStatus;
  void qrPublicId;
  void assetId;
  return legacy;
}

function versionTwoDatabase() {
  const current = generateSeedData();
  return {
    ...structuredClone(current),
    schemaVersion: 2,
    devices: current.devices.map(withoutManagedIdentity),
  };
}

function qrFactory() {
  let sequence = 0;
  return () => `qr_${String(sequence += 1).padStart(32, '0')}`;
}

describe('managed Device schema migration', () => {
  it('migrates every legacy PC identity and preserves operational, technical, placement, and unrelated data', () => {
    const legacy = versionTwoDatabase();
    const result = normalizeDatabase(legacy, { migratedAt: MIGRATED_AT, generateQrPublicId: qrFactory() });

    expect(result).toMatchObject({ ok: true, changed: true, migratedFromVersion: 2 });
    if (!result.ok) return;
    expect(result.db.schemaVersion).toBe(CURRENT_DB_SCHEMA_VERSION);
    expect(result.db.devices).toHaveLength(legacy.devices.length);
    result.db.devices.forEach((device, index) => {
      expect(device).toMatchObject({
        ...legacy.devices[index],
        deviceType: 'desktop_pc',
        lifecycleStatus: 'in_service',
      });
      expect(device.qrPublicId).toMatch(/^qr_[A-Za-z0-9_-]{16,}$/);
    });
    expect(new Set(result.db.devices.map((device) => device.qrPublicId))).toHaveLength(result.db.devices.length);
    expect(result.db.layouts).toEqual(legacy.layouts);

    const unrelatedKeys = Object.keys(legacy).filter((key) => !['schemaVersion', 'devices'].includes(key));
    for (const key of unrelatedKeys) {
      expect((result.db as unknown as Record<string, unknown>)[key]).toEqual((legacy as unknown as Record<string, unknown>)[key]);
    }
  });

  it('persists a version-2 migration once and preserves exact QR identities on every later read', () => {
    storage.seed(DB_KEY, JSON.stringify(versionTwoDatabase()));
    storage.seed(STORAGE_KEYS.VERSION, '2.0.0');

    const first = loadDB();
    expect(first).toMatchObject({ ok: true, mode: 'persisted', migrated: true });
    if (!first.ok) return;
    const firstQrPublicIds = first.db.devices.map((device) => device.qrPublicId);
    expect(storage.writesFor(DB_KEY)).toBe(1);
    expect(storage.getItem(STORAGE_KEYS.VERSION)).toBe(CURRENT_STORAGE_VERSION);

    const persistedAfterMigration = storage.getItem(DB_KEY);
    const second = loadDB();
    expect(second).toMatchObject({ ok: true, mode: 'persisted', migrated: false });
    if (!second.ok) return;
    expect(second.db.devices.map((device) => device.qrPublicId)).toEqual(firstQrPublicIds);
    expect(storage.getItem(DB_KEY)).toBe(persistedAfterMigration);
    expect(storage.writesFor(DB_KEY)).toBe(1);
  });

  it('round-trips a current canonical database without changing QR identity', () => {
    const db = generateSeedData();
    storage.seed(DB_KEY, JSON.stringify(db));
    storage.seed(STORAGE_KEYS.VERSION, CURRENT_STORAGE_VERSION);

    const loaded = loadDB();
    expect(loaded).toMatchObject({ ok: true, mode: 'persisted', migrated: false });
    if (!loaded.ok) return;
    expect(loaded.db.devices.map((device) => device.qrPublicId)).toEqual(db.devices.map((device) => device.qrPublicId));
    expect(storage.writesFor(DB_KEY)).toBe(0);
  });

  it('fails QR migration atomically without mutating or returning a partial database', () => {
    const legacy = versionTwoDatabase();
    const before = JSON.stringify(legacy);
    const result = normalizeDatabase(legacy, {
      migratedAt: MIGRATED_AT,
      generateQrPublicId: () => 'qr_samepublicidentifier000000000000',
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'managed-device-migration-failed', validationIssueCode: 'qr-generation-failed' })],
    });
    expect(JSON.stringify(legacy)).toBe(before);
    expect('db' in result).toBe(false);
  });

  it('preserves malformed version-2 source bytes and enters the existing recovery mode', () => {
    const malformed = versionTwoDatabase() as unknown as Record<string, unknown>;
    delete malformed.devices;
    const raw = JSON.stringify(malformed);
    storage.seed(DB_KEY, raw);
    storage.seed(STORAGE_KEYS.VERSION, '2.0.0');

    const loaded = loadDB();
    expect(loaded).toMatchObject({ ok: false, mode: 'recovery', rawPreserved: true });
    expect(storage.getItem(DB_KEY)).toBe(raw);
    expect(storage.writesFor(DB_KEY)).toBe(0);
  });
});
